"""The one plot each kind of file can honestly support.

A grid with spectra gets its spectra; one that carries only an ionising
luminosity gets that map; an instrument gets its transmission curves; a dust
grid gets its curves. A file that can support none of them gets no image and a
reason, because a plot of nothing is worse than a blank space -- somebody will
read meaning into it.

`choose` is where that decision is made, once, from the open file and its
catalogue row, so every caller renders the same thing for the same file.
"""

from __future__ import annotations

from typing import Any

import h5py
import numpy as np
from matplotlib.colors import Normalize

from syndex.previews.figure import (
    CMAP,
    DIM,
    MUTED,
    colour,
    frame,
    reduce_lam,
    render_png,
    tidy_log_x,
)
from syndex.previews.r2 import READ_BUDGET_BYTES, open_r2

# preview_kind on the files row, constrained by migration 0007 to these three.
PREVIEW_KINDS = {
    "spectra_preview": "spectra",
    "dust_preview": "spectra",
    "filters_preview": "filters",
    "ionising_preview": "ionising",
}


# Only these three data types are HDF5 with something plottable inside; the
# rest are archives h5py cannot open at all. Checking the type before opening
# the file is what stops a run reporting 56 spurious "file signature not
# found" errors.
PLOTTABLE_DATA_TYPES = ("grid", "dust_grid", "instrument")


def spectra_preview(hdf: h5py.File, name: str, kind: str = "spectra"):
    """Plot every spectrum in the grid, ordered and coloured by peak luminosity.

    All spectra are drawn, not a sample: the distribution is the point. Order
    and colour both follow peak luminosity, so the envelope reads as a
    brightness sequence rather than an undifferentiated smear, and the
    brightest are drawn last so they are not buried.

    Args:
        hdf: The open grid file.
        name: Dataset name, for messages.
        kind: The group holding the spectra.

    Returns:
        A tuple of the figure and ``None``, or ``None`` and the reason no
        honest plot is possible.
    """
    group = hdf[kind]
    lam = group["wavelength"][...]
    keep = reduce_lam(lam)
    lam_small = lam[keep]

    # What to plot depends on what the grid is. An unprocessed grid has only
    # its incident stellar emission. A photoionised grid's emergent emission is
    # transmitted plus nebular: the starlight that escapes the birth cloud plus
    # what the gas re-emits. Plotting nebular alone shows the gas emission and
    # misses the continuum entirely.
    #
    # Dust grids name theirs differently again (pdr, diffuse, ...), so fall
    # back to the largest primary dataset rather than giving up.
    if "transmitted" in group and "nebular" in group:
        parts = ["transmitted", "nebular"]
    elif "incident" in group:
        parts = ["incident"]
    else:
        names = [
            k for k in group if k != "wavelength" and getattr(group[k], "ndim", 0) >= 1
        ]
        # A name like pdr_fsil is a derived fraction of pdr, so prefer the base
        # quantity when both are present.
        primary = [
            k
            for k in names
            if not any(k != other and k.startswith(other + "_") for other in names)
        ]
        pool = primary or names
        parts = (
            [max((int(np.prod(group[k].shape)), k) for k in pool)[1]] if pool else []
        )
    if not parts:
        return None, "no spectra dataset"
    chosen = " + ".join(parts)

    datasets = [group[part] for part in parts]
    if len({d.shape for d in datasets}) != 1:
        return None, f"{chosen} have mismatched shapes"
    data = datasets[0]
    n_lam = data.shape[-1]
    lead = data.shape[:-1]
    total = int(np.prod(lead)) if lead else 1
    if total == 0 or n_lam == 0:
        return None, "empty spectra dataset"

    # Read in slices bounded by a memory budget rather than reading the whole
    # array, which for the largest grids is tens of gigabytes. Enough leading
    # axes are consumed per read to stay under the budget.
    per_row = n_lam * data.dtype.itemsize
    depth, rows = 0, total
    while depth < len(lead) - 1 and rows * per_row > READ_BUDGET_BYTES:
        rows //= lead[depth]
        depth += 1

    reduced = np.empty((total, keep.size), dtype=np.float32)
    written = 0
    outer = lead[:depth] if depth else ()
    for index in np.ndindex(*outer) if outer else [()]:
        chunk = None
        for dataset in datasets:
            piece = np.asarray(dataset[index]).reshape(-1, n_lam)[:, keep]
            chunk = piece if chunk is None else chunk + piece
        reduced[written : written + chunk.shape[0]] = chunk.astype(np.float32)
        written += chunk.shape[0]
    reduced = reduced[:written]

    peaks = np.nanmax(reduced, axis=1)
    alive = np.isfinite(peaks) & (peaks > 0)
    if not alive.any():
        return None, "every spectrum is zero or non-finite"
    reduced, peaks = reduced[alive], peaks[alive]

    order = np.argsort(peaks)
    reduced, peaks = reduced[order], peaks[order]

    # Frame the emission first, then take the limits from what is in frame.
    #
    # These grids run out to 3e11 Angstrom, where every spectrum has long since
    # died. Limits derived from the peaks therefore left every spectrum exiting
    # the bottom of the frame, which is what made the plots look sliced: on one
    # BC03 grid all 1547 of them did. The value range across a grid reaches 52
    # decades, so no choice of floor can show all of it. The answer is to frame
    # the part that carries the emission.
    #
    # A spectrum's own band is where it rises within a hundredth of its peak.
    # Percentiles of those bounds give the ensemble's band while ignoring a
    # stray spectrum whose maximum sits far out in the ultraviolet, which would
    # otherwise drag the axis across ten empty decades.
    band = reduced >= peaks[:, None] * 1e-2
    if not band.any():
        return None, "no spectrum rises within a hundredth of its own peak"
    lower = lam_small[np.argmax(band, axis=1)]
    upper = lam_small[band.shape[1] - 1 - np.argmax(band[:, ::-1], axis=1)]
    low = float(np.percentile(lower, 5))
    high = float(np.percentile(upper, 75))
    window = (lam_small >= low) & (lam_small <= high)
    if window.sum() < 2:
        window = np.ones(lam_small.size, dtype=bool)
    lam_small, reduced = lam_small[window], reduced[:, window]

    # Five decades below the faintest peak inside the window, following
    # Synthesizer's per-spectrum rule, so even the dimmest shows its shape.
    visible = np.nanmax(reduced, axis=1)
    lit = visible[np.isfinite(visible) & (visible > 0)]
    if lit.size == 0:
        return None, "nothing finite inside the plotted window"
    top = float(lit.max())
    floor = max(float(lit.min()) / 1e5, top / 1e15)

    # A third of a decade of headroom. Synthesizer's 10 ** (log10(top) * 1.05)
    # scales the exponent and reserves a whole extra decade at 1e23; a fixed
    # 12% went the other way and left the brightest curve flush with the frame.
    ceiling = top * 10**0.35

    ranks = (
        np.linspace(0.0, 1.0, reduced.shape[0]) if reduced.shape[0] > 1 else np.zeros(1)
    )
    figure, axes = frame(r"wavelength / $\rm\AA$")
    axes.set_xscale("log")
    axes.set_yscale("log")
    units = datasets[0].attrs.get("Units")
    units = units.decode() if isinstance(units, bytes) else units
    axes.set_ylabel(
        rf"{chosen}" + (f" / {units}" if units else ""), color=MUTED, fontsize=9
    )

    alpha = float(np.clip(12.0 / np.sqrt(reduced.shape[0]), 0.02, 0.6))
    for index in range(reduced.shape[0]):
        axes.plot(
            lam_small,
            reduced[index],
            linewidth=0.6,
            color=colour(ranks[index]),
            alpha=alpha,
        )

    axes.set_ylim(floor, ceiling)
    axes.set_xlim(lam_small.min() * 0.9, lam_small.max() * 1.1)
    return figure, None


def _mesh_edges(values: np.ndarray, log: bool) -> tuple[float, float]:
    """Return the outer edges of the cells ``nearest`` shading actually draws.

    Autoscaling leaves margins past the cells, so the mesh floats inside empty
    axes.

    Args:
        values: The axis sample positions.
        log: Whether the axis is logarithmic, which changes what half a cell is.

    Returns:
        The lower and upper limit for the axis.
    """
    values = np.asarray(values, dtype=float)
    if values.size == 1:
        span = abs(values[0]) * 0.1 or 1.0
        return values[0] - span, values[0] + span
    if log:
        steps = np.sqrt(values[1:] / values[:-1])
        return values[0] / steps[0], values[-1] * steps[-1]
    steps = np.diff(values) / 2
    return values[0] - steps[0], values[-1] + steps[-1]


def ionising_preview(hdf: h5py.File, name: str):
    """Map ionising luminosity over the grid's first two axes.

    These grids carry only log10_specific_ionising_luminosity, so it is the one
    real quantity they have. Drawn as lines against a single axis it was close
    to useless: a seven-axis grid collapsed to four visible traces and said
    nothing about where in the grid the luminosity varies.

    A map over the two leading axes shows that directly. Any remaining axes are
    averaged over, which the caption states rather than implying a slice.

    Args:
        hdf: The open grid file.
        name: Dataset name, for messages.

    Returns:
        A tuple of the figure and ``None``, or ``None`` and the reason no
        honest plot is possible.
    """
    group = hdf["log10_specific_ionising_luminosity"]
    element = min(group)
    values = np.asarray(group[element])
    axis_names = [str(a) for a in hdf.attrs.get("axes", [])]
    if values.ndim < 2 or len(axis_names) < 2:
        return None, f"needs two axes, has {values.ndim} and {len(axis_names)}"

    x = np.asarray(hdf[f"axes/{axis_names[0]}"])
    y = np.asarray(hdf[f"axes/{axis_names[1]}"])
    if values.shape[:2] != (x.size, y.size):
        return None, f"axes {x.size}x{y.size} do not match data {values.shape}"

    # Average over everything beyond the first two axes.
    grid = values
    if values.ndim > 2:
        grid = np.nanmean(values.reshape(x.size, y.size, -1), axis=2)
    if not np.isfinite(grid).any():
        return None, "no finite ionising luminosities"

    figure, axes = frame(axis_names[0])
    axes.set_ylabel(axis_names[1], color=MUTED, fontsize=9)

    # Log the axes only where the values actually span decades and are
    # positive; a metallicity axis starting at zero cannot be logged.
    for setter, vals in ((axes.set_xscale, x), (axes.set_yscale, y)):
        finite = vals[np.isfinite(vals) & (vals > 0)]
        if finite.size == vals.size and finite.max() / finite.min() > 50:
            setter("log")

    mesh = axes.pcolormesh(
        x,
        y,
        grid.T,
        cmap=CMAP,
        shading="nearest",
        vmin=np.nanmin(grid),
        vmax=np.nanmax(grid),
    )
    bar = figure.colorbar(mesh, ax=axes, pad=0.02)
    bar.outline.set_edgecolor(DIM)
    bar.ax.tick_params(colors=MUTED, labelsize=7)
    bar.set_label(
        rf"$\log_{{10}}\,\dot{{N}}_{{\rm ion}}$ ({element})",
        color=MUTED,
        fontsize=8,
    )
    axes.set_xlim(*_mesh_edges(x, axes.get_xscale() == "log"))
    axes.set_ylim(*_mesh_edges(y, axes.get_yscale() == "log"))
    # A mesh needs no grid lines over it.
    axes.grid(False)
    return figure, None


def filters_preview(hdf: h5py.File, name: str):
    """Plot filter transmission curves, coloured by pivot wavelength.

    Synthesizer's FilterCollection.plot_transmission_curves carries a literal
    "TODO: Add colours" and a legend at ncol=3, which for 28 NIRCam filters
    would dwarf the plot. At thumbnail size the shape is the information, so the
    curves are coloured by pivot wavelength and the legend dropped.

    Args:
        hdf: The open instrument file.
        name: Dataset name, for messages.

    Returns:
        A tuple of the figure and ``None``, or ``None`` and the reason no
        honest plot is possible.
    """
    filters = hdf["Filters"]
    codes = [k for k in filters if k != "Header"]
    if not codes:
        return None, "no filters in this instrument"

    curves = []
    for code in codes:
        entry = filters[code]
        if "Original_Wavelength" in entry and "Original_Transmission" in entry:
            lam = entry["Original_Wavelength"][...]
            transmission = entry["Original_Transmission"][...]
        elif "Transmission" in entry and "Wavelengths" in filters.get("Header", {}):
            lam = filters["Header"]["Wavelengths"][...]
            transmission = entry["Transmission"][...]
        else:
            continue
        if transmission.max() <= 0:
            continue
        pivot = float(np.average(lam, weights=np.clip(transmission, 0, None)))
        curves.append((pivot, lam, transmission))

    if not curves:
        return None, "no usable transmission curves"
    curves.sort()
    pivots = np.array([c[0] for c in curves])
    normed = Normalize(vmin=np.log10(pivots.min()), vmax=np.log10(pivots.max()))

    figure, axes = frame(r"wavelength / $\rm\AA$")
    axes.set_xscale("log")
    axes.set_ylabel(r"transmission", color=MUTED, fontsize=9)

    # Filled to the zero line, which is how a bandpass reads. Draw widest first
    # so a broad filter cannot bury the narrow ones sitting inside its range,
    # and keep the outline opaque so overlapping fills stay separable.
    def width(entry) -> float:
        """Effective width of one filter, for ordering the legend.

        Args:
            entry: A (code, wavelength, transmission) triple.

        Returns:
            float: The span over which the filter transmits appreciably.
        """
        _, lam, transmission = entry
        above = lam[transmission > 0.01 * transmission.max()]
        return float(above.max() - above.min()) if above.size else 0.0

    for pivot, lam, transmission in sorted(curves, key=width, reverse=True):
        shade = colour(normed(np.log10(pivot)))
        axes.fill_between(lam, transmission, color=shade, alpha=0.45, linewidth=0)
        axes.plot(lam, transmission, linewidth=1.1, color=shade, alpha=1.0)
    axes.set_ylim(0, None)
    tidy_log_x(axes)
    return figure, None


def dust_preview(hdf: h5py.File, name: str):
    """Plot a dust grid's extinction curves, or its emission, whichever is here.

    Args:
        hdf: The open dust grid file.
        name: Dataset name, for messages.

    Returns:
        A tuple of the figure and ``None``, or ``None`` and the reason no
        honest plot is possible.
    """
    if "extinction_curves" in hdf:
        return spectra_preview(hdf, name, kind="extinction_curves")
    if "spectra" in hdf:
        return spectra_preview(hdf, name, kind="spectra")
    return None, "neither extinction_curves nor spectra"


def choose(hdf: h5py.File, row: dict[str, Any]):
    """Pick the preview a file can actually support.

    Args:
        hdf: The open file.
        row: The catalogue row, which supplies ``data_type`` and
            ``has_spectra``.

    Returns:
        The plotting function, or ``None`` when this kind of file has no
        indicative single plot.
    """
    if row["data_type"] == "instrument":
        return filters_preview
    if row["data_type"] == "dust_grid":
        return dust_preview
    if row["data_type"] != "grid":
        return None
    if row["has_spectra"]:
        return spectra_preview
    if "log10_specific_ionising_luminosity" in hdf:
        return ionising_preview
    return None


def make_preview(client, bucket: str, row: dict[str, Any]) -> tuple[bytes, str] | str:
    """Render one file's preview.

    Args:
        client: Configured boto3 S3 client.
        bucket: R2 bucket name.
        row: The catalogue row.

    Returns:
        A tuple of the PNG bytes and the preview kind, or a string explaining
        why this file gets no image.
    """
    if row["data_type"] not in PLOTTABLE_DATA_TYPES:
        return f"{row['data_type']} has no indicative plot"
    hdf, _ = open_r2(client, bucket, row["r2_path"], row["size_bytes"])
    with hdf:
        plotter = choose(hdf, row)
        if plotter is None:
            return "nothing plottable in this file"
        figure, reason = plotter(hdf, row["name"])
        if figure is None:
            return reason
        return render_png(figure), PREVIEW_KINDS[plotter.__name__]
