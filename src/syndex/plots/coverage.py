"""What the grids actually cover.

Wavelengths, model families and emission types, the age and metallicity
sampled by the SPS grids, the photoionisation parameters, and the initial mass
functions in use. Each is a question somebody asks before choosing a grid, and
each is answered from the same loaded catalogue.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from matplotlib.patches import Rectangle

from syndex.plots.api import grids, stellar_grids
from syndex.plots.layout import fit_labels
from syndex.plots.palette import (
    INK_MUTED,
    INK_PRIMARY,
    INK_SECONDARY,
    SEQUENTIAL,
    SERIES,
    SURFACE,
)
from syndex.plotting import plt


def plot_wavelengths(catalogue: dict[str, Any], path: Path) -> None:
    """Draw the distinct wavelength ranges the grids cover.

    Most grids share a coverage with many others, so one row per grid is 150
    near-identical stripes. Identical spans are collapsed into one row
    carrying the number of grids that share it.

    Args:
        catalogue: Loaded catalogue.
        path: Where to write the figure.
    """
    # Angstrom is the common unit; convert the few grids stored in microns.
    scale = {"Å": 1.0, "angstrom": 1.0, "μm": 1e4, "um": 1e4}
    spans: dict[tuple[str, float, float], int] = defaultdict(int)
    for detail in grids(catalogue):
        grid = detail["current_release"]["grid"]
        low, high = grid.get("wavelength_min"), grid.get("wavelength_max")
        factor = scale.get(grid.get("wavelength_units"))
        if not low or not high or factor is None:
            continue
        # Round to two significant figures so trivially different spans group.
        key = (
            grid["grid_type"],
            float(f"{low * factor:.2g}"),
            float(f"{high * factor:.2g}"),
        )
        spans[key] += 1

    kinds = ["sps", "agn", "dust"]
    rows = sorted(
        spans.items(),
        key=lambda item: (
            kinds.index(item[0][0]) if item[0][0] in kinds else 9,
            item[0][1],
        ),
    )

    figure, axes = plt.subplots(figsize=(10, 0.42 * len(rows) + 2.2))
    labels = []
    for index, ((kind, low, high), count) in enumerate(rows):
        colour = SERIES[kinds.index(kind)] if kind in kinds else INK_MUTED
        axes.plot(
            [low, high],
            [index, index],
            color=colour,
            linewidth=5,
            solid_capstyle="round",
        )
        labels.append(
            axes.text(
                high * 1.6,
                index,
                f"{count} grid{'s' if count > 1 else ''}",
                va="center",
                fontsize=9,
                color=INK_SECONDARY,
            )
        )

    axes.set_xscale("log")
    axes.set_yticks([])
    axes.set_ylim(len(rows), -1)
    axes.set_xlim(right=max(high for (_, _, high), _ in rows) * 2)
    axes.grid(axis="y", visible=False)
    axes.set_xlabel(
        f"Wavelength (Å) — distinct coverage across {sum(spans.values())} grids"
    )

    for kind, colour in zip(kinds, SERIES):
        total = sum(count for (k, _, _), count in spans.items() if k == kind)
        axes.plot([], [], color=colour, linewidth=4, label=f"{kind} ({total})")
    # Below the axis: above collides with the title, inside collides with
    # the marks, which span the full width.
    axes.legend(
        loc="upper center",
        bbox_to_anchor=(0.5, -0.08 - 2.0 / (len(rows) + 6)),
        ncol=3,
        labelcolor=INK_SECONDARY,
    )
    fit_labels(figure, axes, labels)

    figure.savefig(path, bbox_inches="tight")
    plt.close(figure)


def plot_model_emission(catalogue: dict[str, Any], path: Path) -> None:
    """Draw a heatmap of model family against emission type.

    Args:
        catalogue: Loaded catalogue.
        path: Where to write the figure.
    """
    counts: dict[tuple[str, str], int] = defaultdict(int)
    for detail in grids(catalogue):
        # Dust grids are their own data type, and their emission types share
        # no axis with stellar and AGN emission; including them would add two
        # columns that intersect nothing.
        if detail["data_type"] != "grid":
            continue
        grid = detail["current_release"]["grid"]
        counts[(grid.get("model_name") or "unknown", grid["emission_type"])] += 1

    models = sorted(
        {model for model, _ in counts},
        key=lambda m: -sum(count for (name, _), count in counts.items() if name == m),
    )
    emissions = sorted({emission for _, emission in counts})

    figure, axes = plt.subplots(
        figsize=(1.6 + len(emissions) * 1.5, 1.2 + len(models) * 0.45)
    )
    biggest = max(counts.values())
    for row, model in enumerate(models):
        for column, emission in enumerate(emissions):
            count = counts.get((model, emission), 0)
            if count:
                step = SEQUENTIAL[
                    min(len(SEQUENTIAL) - 1, int((count / biggest) ** 0.5 * 11))
                ]
                axes.add_patch(
                    Rectangle(
                        (column - 0.5, row - 0.5),
                        1,
                        1,
                        facecolor=step,
                        edgecolor=SURFACE,
                        linewidth=2,
                    )
                )
                axes.text(
                    column,
                    row,
                    str(count),
                    ha="center",
                    va="center",
                    fontsize=10,
                    color=SURFACE if count / biggest > 0.45 else INK_PRIMARY,
                )

    axes.set_xticks(range(len(emissions)))
    axes.set_xticklabels(
        [e.replace("_", " ") for e in emissions], rotation=20, ha="right"
    )
    axes.set_yticks(range(len(models)))
    axes.set_yticklabels(models)
    axes.set_xlim(-0.5, len(emissions) - 0.5)
    axes.set_ylim(len(models) - 0.5, -0.5)
    axes.grid(visible=False)
    for spine in axes.spines.values():
        spine.set_visible(False)
    figure.savefig(path, bbox_inches="tight")
    plt.close(figure)


def plot_sps_coverage(catalogue: dict[str, Any], path: Path) -> None:
    """Draw the age and metallicity ranges each model family covers.

    Two panels rather than one plot with two x scales, since age in years and
    metallicity in mass fraction share no axis.

    Args:
        catalogue: Loaded catalogue.
        path: Where to write the figure.
    """
    spans: dict[str, dict[str, list[float]]] = defaultdict(
        lambda: {"ages": [], "metallicities": [], "n_ages": [], "n_z": []}
    )
    for detail, grid in stellar_grids(catalogue):
        family = grid.get("model_name") or "unknown"
        for axis in grid.get("axes") or []:
            if axis["name"] not in ("ages", "metallicities"):
                continue
            if axis["minimum"] is None or axis["minimum"] <= 0:
                continue
            key = axis["name"]
            spans[family][key].extend([axis["minimum"], axis["maximum"]])
            spans[family]["n_ages" if key == "ages" else "n_z"].append(axis["count"])

    families = sorted(
        (f for f, data in spans.items() if data["ages"] and data["metallicities"]),
        key=lambda f: min(spans[f]["ages"]),
    )

    figure, (left, right) = plt.subplots(
        1,
        2,
        figsize=(11, 0.42 * len(families) + 2.4),
        gridspec_kw={"wspace": 0.06},
    )
    for index, family in enumerate(families):
        data = spans[family]
        for axes, key, counts in (
            (left, "ages", data["n_ages"]),
            (right, "metallicities", data["n_z"]),
        ):
            low, high = min(data[key]), max(data[key])
            axes.plot(
                [low, high],
                [index, index],
                color=SERIES[0],
                linewidth=5,
                solid_capstyle="round",
            )
            axes.text(
                high * 1.12,
                index,
                f"{min(counts)}–{max(counts)} points"
                if min(counts) != max(counts)
                else f"{min(counts)} points",
                va="center",
                fontsize=8,
                color=INK_SECONDARY,
            )

    for axes, label in ((left, "Age (yr)"), (right, "Metallicity (mass fraction)")):
        axes.set_xscale("log")
        axes.set_xlabel(label)
        axes.set_ylim(len(families) - 0.5, -0.7)
        axes.grid(axis="y", visible=False)
    left.set_yticks(range(len(families)))
    left.set_yticklabels(families, fontsize=9)
    right.set_yticks([])

    figure.canvas.draw()
    for axes in (left, right):
        axes.set_xlim(right=axes.get_xlim()[1] * 6)
    figure.savefig(path, bbox_inches="tight")
    plt.close(figure)


def plot_cloudy(catalogue: dict[str, Any], path: Path) -> None:
    """Draw how the photoionised grids are configured in Cloudy.

    Every parameter gets a full-width bar split by the values in use, so a
    settled parameter reads as one band and a varying one as several. Most of
    this collection is configured identically, which is the point.

    Args:
        catalogue: Loaded catalogue.
        path: Where to write the figure.
    """
    KEYS = [
        "cloudy_version",
        "geometry",
        "grains",
        "depletion_model",
        "ionisation_parameter_model",
        "resolution",
        "hydrogen_density",
        "reference_abundance",
        "reference_metallicity",
        "reference_ionisation_parameter",
        "turbulence",
        "T_floor",
        "cosmic_rays",
        "iterate_to_convergence",
    ]
    params = [
        grid["photoionisation_parameters"]
        for _, grid in stellar_grids(catalogue)
        if grid.get("photoionisation_parameters")
    ]
    rows = []
    for key in KEYS:
        values = Counter(str(p.get(key)) for p in params if key in p)
        if not values:
            continue
        entries = values.most_common()
        absent = len(params) - sum(values.values())
        if absent:
            # A short bar otherwise looks like missing data with no reason.
            entries.append(("not recorded", absent))
        rows.append((key, entries))
    # Parameters that actually vary first: they carry the information.
    rows.sort(key=lambda row: -len(row[1]))

    figure, axes = plt.subplots(figsize=(11, 0.45 * len(rows) + 2.0))
    total = len(params)
    for index, (key, values) in enumerate(rows):
        offset = 0.0
        for slot, (value, count) in enumerate(values):
            width = count / total
            axes.barh(
                index,
                width,
                left=offset,
                height=0.6,
                color=(
                    INK_MUTED if value == "not recorded" else SERIES[slot % len(SERIES)]
                ),
                edgecolor=SURFACE,
                linewidth=2,
            )
            # Only label inside when the segment can hold the text.
            if width > 0.045 * len(f"{value} ({count})") ** 0.55:
                axes.text(
                    offset + width / 2,
                    index,
                    f"{value} ({count})",
                    ha="center",
                    va="center",
                    fontsize=8,
                    color=SURFACE,
                )
            elif slot == len(values) - 1:
                # The last segment can spill to the right of the bar.
                axes.text(
                    offset + width + 0.012,
                    index,
                    f"{value} ({count})",
                    ha="left",
                    va="center",
                    fontsize=8,
                    color=INK_SECONDARY,
                )
            else:
                # A thin middle segment has no room either side, so its label
                # goes above rather than onto its neighbour.
                axes.text(
                    offset + width / 2,
                    index - 0.4,
                    f"{value} ({count})",
                    ha="center",
                    va="bottom",
                    fontsize=8,
                    color=INK_SECONDARY,
                )
            offset += width

    axes.set_yticks(range(len(rows)))
    axes.set_yticklabels([key.replace("_", " ") for key, _ in rows], fontsize=9)
    axes.set_ylim(len(rows) - 0.5, -0.6)
    axes.set_xlim(0, 1.32)
    axes.set_xticks([])
    axes.set_xlabel(f"Share of the {total} photoionised grids")
    axes.grid(visible=False)
    for spine in axes.spines.values():
        spine.set_visible(False)
    figure.savefig(path, bbox_inches="tight")
    plt.close(figure)


def summarise_slopes(slope_sets: set) -> str:
    """Describe a group's power-law slopes, collapsing any that are scanned.

    Args:
        slope_sets: Distinct slope tuples used within one IMF and mass range.

    Returns:
        A short description, with a range where one position varies.
    """
    if not slope_sets:
        return ""
    if len(slope_sets) == 1:
        return ", ".join(f"{s:g}" for s in next(iter(slope_sets)))
    if len({len(s) for s in slope_sets}) == 1:
        # A scanned position becomes "low-high" in place.
        parts = []
        for values in zip(*sorted(slope_sets)):
            unique = sorted(set(values))
            parts.append(
                f"{unique[0]:g}"
                if len(unique) == 1
                else f"{unique[0]:g}\u2013{unique[-1]:g}"
            )
        return ", ".join(parts)
    return f"{len(slope_sets)} slope sets"


def plot_imf(catalogue: dict[str, Any], path: Path) -> None:
    """Draw every initial mass function definition in the collection.

    One row per distinct IMF, spanning its mass range with a marker at each
    break point, so a broken power law is visibly different from a single
    range.

    Args:
        catalogue: Loaded catalogue.
        path: Where to write the figure.
    """
    # Slopes are summarised rather than given a row each: FSPS scans one
    # slope across 16 values, which would otherwise be 16 identical bars.
    variants: dict[tuple[str, tuple[float, ...]], dict[str, Any]] = defaultdict(
        lambda: {"count": 0, "slopes": set()}
    )
    for _, grid in stellar_grids(catalogue):
        model = grid.get("model_parameters") or {}
        imf = model.get("imf_type")
        masses = model.get("imf_masses")
        if not imf or not masses or not isinstance(masses, list):
            continue
        entry = variants[(str(imf), tuple(float(m) for m in masses))]
        entry["count"] += 1
        slopes = model.get("imf_slopes")
        if isinstance(slopes, list) and slopes:
            entry["slopes"].add(tuple(float(s) for s in slopes))

    rows = sorted(variants.items(), key=lambda item: (item[0][0], item[0][1][0]))

    figure, axes = plt.subplots(figsize=(10, 0.4 * len(rows) + 2.0))
    labels = []
    for index, ((imf, masses), entry) in enumerate(rows):
        count = entry["count"]
        low, high = min(masses), max(masses)
        axes.plot(
            [low, high],
            [index, index],
            color=SERIES[0],
            linewidth=4,
            solid_capstyle="round",
            zorder=2,
        )
        # Break points are what distinguish a broken power law.
        breaks = [m for m in masses if low < m < high]
        if breaks:
            axes.plot(
                breaks,
                [index] * len(breaks),
                marker="|",
                markersize=13,
                markeredgewidth=2,
                linestyle="none",
                color=SURFACE,
                zorder=3,
            )
        slope_text = summarise_slopes(entry["slopes"])
        labels.append(
            axes.text(
                high * 1.1,
                index,
                f"{count} grid{'s' if count > 1 else ''}"
                + (f" · slopes {slope_text}" if slope_text else ""),
                va="center",
                fontsize=8,
                color=INK_SECONDARY,
            )
        )

    axes.set_yticks(range(len(rows)))
    axes.set_yticklabels(
        [f"{imf}  {min(masses):g}–{max(masses):g}" for (imf, masses), _ in rows],
        fontsize=9,
    )
    axes.set_xscale("log")
    axes.set_xlabel("Stellar mass (Msun)")
    axes.set_ylim(len(rows) - 0.5, -0.6)
    axes.grid(axis="y", visible=False)
    axes.set_xlim(right=max(max(m) for (_, m), _ in rows) * 1.4)
    fit_labels(figure, axes, labels)
    figure.savefig(path, bbox_inches="tight")
    plt.close(figure)
