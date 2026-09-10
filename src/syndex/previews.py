"""Indicative preview plots for individual catalogue files.

Every published file that can be plotted gets one small PNG, stored in R2
alongside the data and recorded on the file row in D1. The portal shows it as a
thumbnail on the dataset page. A file that cannot honestly be summarised in one
plot gets no image rather than a misleading one, and the reason is reported.

The files are read straight out of R2 over HTTP range requests, so a 26 GiB
grid never lands on disc. Generation, upload and the D1 update are separate
steps behind one manifest, which makes a long run resumable: an interrupted
pass costs only the file in flight.

    syndex-previews --output-dir plots --only bc03-2016-basel-chabrier   # judge
    syndex-previews --apply                                             # publish

The y-range rule is Synthesizer's, from ``emissions/sed.py plot_spectra``: five
decades below the peak. Without it a grid spanning forty orders of magnitude
plots as a flat line along the bottom of the axes.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
import time
import traceback
import urllib.error
import urllib.request
from collections import OrderedDict
from pathlib import Path
from typing import Any

import h5py
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import matplotlib.ticker
import numpy as np
from matplotlib.colors import Normalize

from syndex.upload import (
    DEFAULT_ACCOUNT_ID,
    DEFAULT_BUCKET,
    DEFAULT_DATABASE_ID,
    UploadError,
    _make_s3_client,
)

# Two themes, so the same plot can be judged on either ground. The default is
# the portal's dark page; light gives a figure that also works in a paper or a
# talk.
#
# Each ground loses about a third of the colormap, but at opposite ends: on
# white the pale yellow falls below the 3.0 contrast floor, on the dark page it
# is the near-black. Both truncations are measured, so the colours used are
# always distinguishable from the ground they sit on.
THEME = os.environ.get("PREVIEW_THEME", "dark")
if THEME == "dark":
    # Transparent, so the page shows through. Ink is chosen for the dark portal
    # ground, which means these are portal figures: a transparent PNG with
    # light ink is unreadable on a white page.
    INK, MUTED, DIM = "#dce8f2", "#6484a0", "#304a62"
    CMAP_FLOOR, CMAP_CEILING = 0.46, 1.0
else:
    INK, MUTED, DIM = "#1a1a1a", "#5a5a5a", "#c8c8c8"
    CMAP_FLOOR, CMAP_CEILING = 0.0, 0.68
CMAP = matplotlib.colormaps["magma"]

# A thumbnail resolves nothing like the native sampling, so wavelengths are
# reduced on the way in. This is what keeps a 26 GiB grid inside memory without
# dropping any spectra, which is the thing worth showing.
TARGET_LAM = 1200

# Reading whole leading axes at a time keeps h5py's slicing simple; this bounds
# how much of one grid is resident while that happens.
READ_BUDGET_BYTES = 256 << 20

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


def colour(fraction: float):
    """Map 0-1 onto the part of the colormap that is visible on this ground.

    Args:
        fraction: Position along the ramp, 0 for the first visible colour.

    Returns:
        An RGBA tuple.
    """
    return CMAP(CMAP_FLOOR + (CMAP_CEILING - CMAP_FLOOR) * fraction)


class R2File(io.RawIOBase):
    """Seekable read-only file over an R2 object, with a block cache.

    h5py seeks constantly, and an uncached reader re-fetches the same regions:
    reading a 14.5 MB file that way cost 21.5 MB of transfer. Caching aligned
    blocks makes the transfer roughly the bytes actually needed.
    """

    BLOCK = 4 << 20
    MAX_BLOCKS = 64

    def __init__(self, client, bucket: str, key: str, size: int):
        """Wrap one R2 object.

        Args:
            client: Configured boto3 S3 client.
            bucket: R2 bucket name.
            key: R2 object key.
            size: Object size in bytes, which bounds every read.
        """
        self._client, self._bucket, self._key = client, bucket, key
        self._size, self._pos = size, 0
        self._blocks: OrderedDict[int, bytes] = OrderedDict()
        self.fetched = 0

    def readable(self) -> bool:
        """Report that the file can be read."""
        return True

    def seekable(self) -> bool:
        """Report that the file can be seeked, which h5py requires."""
        return True

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        """Move the read position, clamped to the object.

        Args:
            offset: Byte offset relative to ``whence``.
            whence: One of the ``io.SEEK_*`` constants.

        Returns:
            The new absolute position.
        """
        base = {
            io.SEEK_SET: 0,
            io.SEEK_CUR: self._pos,
            io.SEEK_END: self._size,
        }[whence]
        self._pos = max(0, min(self._size, base + offset))
        return self._pos

    def tell(self) -> int:
        """Return the current read position."""
        return self._pos

    def _block(self, index: int) -> bytes:
        """Return one aligned block, fetching it if it is not cached.

        Args:
            index: Block number, counting from the start of the object.

        Returns:
            The block's bytes, shorter than ``BLOCK`` only for the last one.
        """
        if index in self._blocks:
            self._blocks.move_to_end(index)
            return self._blocks[index]
        start = index * self.BLOCK
        end = min(start + self.BLOCK, self._size) - 1
        data = self._client.get_object(
            Bucket=self._bucket, Key=self._key, Range=f"bytes={start}-{end}"
        )["Body"].read()
        self.fetched += len(data)
        self._blocks[index] = data
        while len(self._blocks) > self.MAX_BLOCKS:
            self._blocks.popitem(last=False)
        return data

    def readinto(self, buffer) -> int:
        """Fill ``buffer`` from the cached blocks covering the read.

        Args:
            buffer: Writable buffer to fill.

        Returns:
            Number of bytes written, 0 at end of file.
        """
        want = min(len(buffer), self._size - self._pos)
        if want <= 0:
            return 0
        written = 0
        while written < want:
            index = (self._pos + written) // self.BLOCK
            block = self._block(index)
            offset = (self._pos + written) - index * self.BLOCK
            take = min(len(block) - offset, want - written)
            if take <= 0:
                break
            buffer[written : written + take] = block[offset : offset + take]
            written += take
        self._pos += written
        return written


def open_r2(client, bucket: str, key: str, size: int):
    """Open an R2 object as an HDF5 file without downloading it.

    Args:
        client: Configured boto3 S3 client.
        bucket: R2 bucket name.
        key: R2 object key.
        size: Object size in bytes.

    Returns:
        A tuple of the open ``h5py.File`` and the underlying ``R2File``, whose
        ``fetched`` attribute reports how much was actually transferred.
    """
    handle = R2File(client, bucket, key, size)
    return h5py.File(io.BufferedReader(handle, buffer_size=1 << 20), "r"), handle


def frame(title: str):
    """Create a figure sized for a portal card, with no chrome of its own.

    Args:
        title: The x axis label; these plots carry no chart title.

    Returns:
        A tuple of the figure and its axes.
    """
    figure, axes = plt.subplots(figsize=(6.4, 4.0), dpi=150)
    # No background of its own: the page provides it.
    figure.patch.set_alpha(0.0)
    axes.patch.set_alpha(0.0)
    # A closed frame on all four sides, which is the convention these plots sit
    # alongside in the literature, and which makes a curve reaching the edge
    # obviously at the edge rather than ambiguously running off.
    for side in ("top", "right", "left", "bottom"):
        axes.spines[side].set_visible(True)
        axes.spines[side].set_color(DIM)
    axes.tick_params(which="both", top=True, right=True, direction="in")
    axes.tick_params(colors=MUTED, labelsize=8, which="both")
    axes.grid(True, color=DIM, alpha=0.35 if THEME == "dark" else 0.6, linewidth=0.5)
    axes.set_axisbelow(True)
    # Facts live in the axis labels and a caption, not a chart title.
    axes.set_xlabel(title, color=MUTED, fontsize=9)
    return figure, axes


def tidy_log_x(axes) -> None:
    """Label a log x axis that spans too little to get decade ticks.

    A filter set covering 6,000-50,000 Angstrom otherwise gets a single "10^4"
    and no sense of scale at all.

    Args:
        axes: The axes to relabel.
    """
    low, high = axes.get_xlim()
    if high / max(low, 1e-30) < 100:
        axes.xaxis.set_major_formatter(matplotlib.ticker.ScalarFormatter())
        axes.xaxis.set_minor_formatter(matplotlib.ticker.ScalarFormatter())
        axes.tick_params(axis="x", which="minor", labelsize=6)
        axes.tick_params(axis="x", which="major", labelsize=7)


def render_png(figure) -> bytes:
    """Render a figure to PNG bytes and close it.

    Closing here rather than at the call sites is what keeps a run of 244 files
    from accumulating every figure it ever drew.

    Args:
        figure: The figure to render.

    Returns:
        The PNG bytes.
    """
    buffer = io.BytesIO()
    figure.savefig(
        buffer, format="png", transparent=True, bbox_inches="tight", pad_inches=0.25
    )
    plt.close(figure)
    return buffer.getvalue()


def reduce_lam(lam: np.ndarray, count: int = TARGET_LAM) -> np.ndarray:
    """Return indices that thin a wavelength grid without moving its endpoints.

    Args:
        lam: The wavelength array.
        count: Target number of samples.

    Returns:
        Sorted, unique indices into ``lam``.
    """
    if lam.size <= count:
        return np.arange(lam.size)
    return np.unique(np.linspace(0, lam.size - 1, count).astype(int))


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


# The current release of every dataset, with everything the choice of plot and
# the D1 update need. Superseded releases are left alone: the portal only ever
# shows the current one, and regenerating history would cost days of transfer
# for images nothing links to.
CANDIDATE_SQL = """
SELECT d.name, d.data_type, f.file_id, f.r2_path, f.size_bytes,
       f.preview_path, f.preview_kind,
       COALESCE(g.has_spectra, 0) AS has_spectra
FROM datasets d
JOIN releases r ON r.release_id = d.current_release_id
JOIN files f ON f.file_id = r.file_id
LEFT JOIN grid_metadata g ON g.release_id = r.release_id
ORDER BY f.size_bytes ASC
"""


def d1_query(
    account_id: str, database_id: str, token: str, sql: str, params: list | None = None
) -> list[dict[str, Any]]:
    """Run one statement against D1 and return its rows.

    Args:
        account_id: Cloudflare account identifier.
        database_id: D1 database identifier.
        token: Cloudflare API token with D1 access.
        sql: The statement.
        params: Bound parameters.

    Returns:
        The result rows as dictionaries.

    Raises:
        UploadError: If D1 rejects the statement.
    """
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/d1/database/{database_id}/query",
        data=json.dumps({"sql": sql, "params": params or []}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise UploadError(f"D1 query failed: HTTP {exc.code}: {detail}") from exc
    if not payload.get("success"):
        raise UploadError(f"D1 query failed: {payload.get('errors', payload)}")
    return payload["result"][0]["results"]


def upload_preview(client, bucket: str, png: bytes, name: str, kind: str) -> str:
    """Store a preview in R2, content addressed, and return its key.

    Content addressing means regenerating an unchanged plot writes the same key
    and costs nothing. It also means a changed plot writes a new key and leaves
    the old object behind, so a failed run leaks silently: sweep orphans by
    comparing the bucket against ``files.preview_path``.

    Args:
        client: Configured boto3 S3 client.
        bucket: R2 bucket name.
        png: The rendered image.
        name: Dataset name, used only for a readable filename.
        kind: The preview kind, recorded as object metadata.

    Returns:
        The R2 object key.
    """
    digest = hashlib.sha256(png).hexdigest()
    key = f"preview/{digest}/{name}.png"
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=png,
        ContentType="image/png",
        Metadata={"sha256": digest, "kind": kind},
    )
    return key


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


def _parser() -> argparse.ArgumentParser:
    """Build the command line parser."""
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="write PNGs here instead of uploading them, for judging a change",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="upload each preview to R2 and record it on the file row in D1",
    )
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="NAME",
        help="restrict to this dataset; repeatable",
    )
    parser.add_argument("--limit", type=int, help="stop after this many files")
    parser.add_argument(
        "--manifest",
        type=Path,
        help="resume state; defaults to previews-manifest.json beside the output",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="regenerate files the manifest has already recorded",
    )
    parser.add_argument("--account-id", default=DEFAULT_ACCOUNT_ID)
    parser.add_argument("--database-id", default=DEFAULT_DATABASE_ID)
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    return parser


def run(argv: list[str] | None = None) -> int:
    """Generate previews for every candidate file.

    Args:
        argv: Command line arguments, defaulting to ``sys.argv``.

    Returns:
        Process exit status: 0 when nothing failed, 1 otherwise.
    """
    args = _parser().parse_args(argv)
    token = os.getenv("SYNTHESIZER_D1_API_TOKEN")
    if not token:
        raise UploadError(
            "D1 access is required to list candidates (set SYNTHESIZER_D1_API_TOKEN)"
        )

    rows = d1_query(args.account_id, args.database_id, token, CANDIDATE_SQL)
    if args.only:
        wanted = set(args.only)
        rows = [row for row in rows if row["name"] in wanted]
        missing = wanted - {row["name"] for row in rows}
        for name in sorted(missing):
            print(f"  no current release named {name}")

    manifest_path = args.manifest or (
        (args.output_dir or Path(".")) / "previews-manifest.json"
    )
    manifest: dict[str, Any] = (
        json.loads(manifest_path.read_text())
        if manifest_path.exists() and not args.refresh
        else {}
    )

    todo = [row for row in rows if args.refresh or row["name"] not in manifest]
    if args.limit:
        todo = todo[: args.limit]

    # Rendering means reading the grids, which is the expensive part, so a run
    # that would keep nothing lists the work instead of doing it.
    if not args.output_dir and not args.apply:
        for row in todo:
            print(
                f"  {row['name']}  ({row['data_type']}, "
                f"{row['size_bytes'] / 2**20:.0f} MiB)"
            )
        print(
            f"\n  {len(todo)} candidates; pass --output-dir to render locally "
            f"or --apply to publish"
        )
        return 0

    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
    client = _make_s3_client(args.account_id)

    made = omitted = failed = 0

    for position, row in enumerate(todo, start=1):
        name = row["name"]
        started = time.time()
        print(
            f"[{position}/{len(todo)}] {name[:56]} "
            f"({row['size_bytes'] / 2**20:.0f} MiB)",
            flush=True,
        )
        try:
            result = make_preview(client, args.bucket, row)
        except Exception as exc:  # noqa: BLE001 - one bad file must not end a run
            print(f"    FAILED: {type(exc).__name__}: {exc}", flush=True)
            traceback.print_exc()
            manifest[name] = {
                "status": "error",
                "reason": f"{type(exc).__name__}: {exc}"[:200],
            }
            failed += 1
            manifest_path.write_text(json.dumps(manifest, indent=1))
            continue

        if isinstance(result, str):
            print(f"    omitted: {result}", flush=True)
            manifest[name] = {"status": "omitted", "reason": result}
            omitted += 1
            manifest_path.write_text(json.dumps(manifest, indent=1))
            continue

        png, kind = result
        entry: dict[str, Any] = {"status": "ok", "kind": kind, "bytes": len(png)}

        if args.output_dir:
            (args.output_dir / f"{name}.png").write_bytes(png)
            entry["path"] = str(args.output_dir / f"{name}.png")
        if args.apply:
            key = upload_preview(client, args.bucket, png, name, kind)
            d1_query(
                args.account_id,
                args.database_id,
                token,
                "UPDATE files SET preview_path = ?, preview_kind = ? WHERE file_id = ?",
                [key, kind, row["file_id"]],
            )
            entry["preview_path"] = key
        manifest[name] = entry
        made += 1
        manifest_path.write_text(json.dumps(manifest, indent=1))
        print(
            f"    {kind}: {len(png) / 1024:.0f} KB in {time.time() - started:.0f}s",
            flush=True,
        )

    print(f"\n  {made} rendered, {omitted} omitted, {failed} failed", flush=True)
    return 1 if failed else 0


def main() -> None:
    """Entry point for ``syndex-previews``."""
    try:
        sys.exit(run())
    except UploadError as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
