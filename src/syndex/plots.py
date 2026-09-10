"""Diagnostic plots of the published catalogue.

Reads the public API rather than D1, so the plots describe exactly what a
client sees, and caches the responses so repeated runs are instant.

    uv run syndex-plots --output-dir plots
    uv run syndex-plots --plot wavelengths --refresh
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

DEFAULT_API_URL = "https://data.synthesizer-project.org"

# Chart chrome, from the project's visualisation palette. Text never wears a
# series colour; grid and axes stay recessive so the marks carry the eye.
SURFACE = "#fcfcfb"
INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
GRIDLINE = "#e1e0d9"
BASELINE = "#c3c2b7"

# Categorical hues in fixed order, never cycled. Only the first three are used
# for any chart whose marks are compared in arbitrary pairs, which is the set
# validated to stay separable under colour-vision deficiency.
SERIES = ["#2a78d6", "#eb6834", "#1baf7a"]

# One-hue sequential ramp for magnitude, lightest step nearest zero.
SEQUENTIAL = [
    "#cde2fb",
    "#b7d3f6",
    "#9ec5f4",
    "#86b6ef",
    "#6da7ec",
    "#5598e7",
    "#3987e5",
    "#2a78d6",
    "#256abf",
    "#1c5cab",
    "#184f95",
    "#104281",
]


def style() -> None:
    """Apply the chart chrome shared by every plot."""
    plt.rcParams.update(
        {
            "figure.facecolor": SURFACE,
            "axes.facecolor": SURFACE,
            "savefig.facecolor": SURFACE,
            "axes.edgecolor": BASELINE,
            "axes.labelcolor": INK_SECONDARY,
            "axes.titlecolor": INK_PRIMARY,
            "axes.titlesize": 13,
            "axes.titleweight": "semibold",
            "axes.titlepad": 14,
            "axes.grid": True,
            "axes.axisbelow": True,
            "grid.color": GRIDLINE,
            "grid.linewidth": 0.8,
            "xtick.color": INK_MUTED,
            "ytick.color": INK_MUTED,
            "text.color": INK_PRIMARY,
            "font.size": 10,
            "figure.dpi": 140,
            "legend.frameon": False,
        }
    )


def fetch(api_url: str, path: str) -> dict[str, Any]:
    """Fetch one JSON document from the catalogue API.

    Args:
        api_url: Base URL of the data service.
        path: API path beginning with a slash.

    Returns:
        Decoded JSON response.

    Raises:
        RuntimeError: If the API cannot be reached or refuses the request.
    """
    request = urllib.request.Request(
        f"{api_url}{path}",
        # Cloudflare rejects urllib's default agent, so name ourselves.
        headers={"User-Agent": "syndex-plots/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach {api_url}{path}: {exc}") from exc


def load_catalogue(api_url: str, cache: Path, refresh: bool) -> dict[str, Any]:
    """Load every dataset and its full detail, caching the result.

    Args:
        api_url: Base URL of the data service.
        cache: File to read from and write to.
        refresh: Whether to ignore any cached copy.

    Returns:
        Mapping with a `datasets` list and a `details` mapping keyed by name.
    """
    if cache.exists() and not refresh:
        return json.loads(cache.read_text())

    datasets = fetch(api_url, "/v1/datasets?limit=1000")["datasets"]
    details = {}
    for index, dataset in enumerate(datasets, start=1):
        print(f"  fetching {index}/{len(datasets)} {dataset['name']}", flush=True)
        details[dataset["name"]] = fetch(api_url, f"/v1/datasets/{dataset['name']}")

    catalogue = {"datasets": datasets, "details": details}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(catalogue))
    return catalogue


def grids(catalogue: dict[str, Any]) -> list[dict[str, Any]]:
    """Return every published grid release with its metadata.

    Args:
        catalogue: Loaded catalogue.

    Returns:
        List of dataset details whose current release carries grid metadata.
    """
    found = []
    for detail in catalogue["details"].values():
        release = detail.get("current_release")
        if release and release.get("grid"):
            found.append(detail)
    return found


def human_bytes(value: float) -> str:
    """Format a byte count for a label.

    Args:
        value: Number of bytes.

    Returns:
        Short human-readable size.
    """
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit != "GB" else f"{value:.1f} GB"
        value /= 1024
    return f"{value:.1f} GB"


def squarify(values: list[float], x: float, y: float, width: float, height: float):
    """Lay out rectangles whose areas are proportional to values.

    A squarified treemap: values are placed in rows chosen to keep each
    rectangle as close to square as possible, which is what makes areas
    comparable by eye.

    Args:
        values: Areas to lay out, largest first.
        x: Left edge of the region.
        y: Bottom edge of the region.
        width: Region width.
        height: Region height.

    Returns:
        List of (x, y, width, height) tuples, one per value.
    """
    total = sum(values)
    if total <= 0:
        return []
    scaled = [value * width * height / total for value in values]

    rectangles: list[tuple[float, float, float, float]] = []
    remaining = list(scaled)
    while remaining:
        side = min(width, height)
        row = [remaining.pop(0)]
        # Grow the row while doing so improves the worst aspect ratio in it.
        while remaining and _worst(row, side) >= _worst(row + [remaining[0]], side):
            row.append(remaining.pop(0))

        row_total = sum(row)
        if width >= height:
            row_width = row_total / height if height else 0
            offset = y
            for area in row:
                cell_height = area / row_width if row_width else 0
                rectangles.append((x, offset, row_width, cell_height))
                offset += cell_height
            x += row_width
            width -= row_width
        else:
            row_height = row_total / width if width else 0
            offset = x
            for area in row:
                cell_width = area / row_height if row_height else 0
                rectangles.append((offset, y, cell_width, row_height))
                offset += cell_width
            y += row_height
            height -= row_height
    return rectangles


def _worst(row: list[float], side: float) -> float:
    """Return the worst aspect ratio in a candidate treemap row.

    Args:
        row: Areas in the row.
        side: Length of the side the row is laid along.

    Returns:
        Worst aspect ratio, or infinity for a degenerate row.
    """
    total = sum(row)
    if total <= 0 or side <= 0:
        return math.inf
    return max(
        max(
            (side * side * area) / (total * total),
            (total * total) / (side * side * area),
        )
        for area in row
        if area > 0
    )


def fit_labels(figure, axes, texts, pad: float = 1.04) -> None:
    """Widen the x axis until every trailing label fits inside it.

    Label width is fixed in points while the axis is in data units, so no
    multiplier of the data range can be right for every label length. This
    measures what was actually rendered instead. Widening the axis makes each
    point cover more data, which pushes the requirement out again, so it
    settles over a few passes.

    Args:
        figure: Figure being drawn.
        axes: Axes holding the labels.
        texts: The label artists to keep inside the axes.
        pad: Extra fraction of headroom past the widest label.
    """
    for _ in range(4):
        figure.canvas.draw()
        renderer = figure.canvas.get_renderer()
        inverse = axes.transData.inverted()
        needed = max(
            inverse.transform((label.get_window_extent(renderer=renderer).x1, 0))[0]
            for label in texts
        )
        current = axes.get_xlim()[1]
        if needed * pad <= current:
            return
        axes.set_xlim(right=needed * pad)


def plot_composition(catalogue: dict[str, Any], path: Path) -> None:
    """Draw catalogue volume and dataset count by data type.

    Grids hold over 99% of the bytes, which a treemap or pie cannot show:
    every other type collapses to a sliver. A log scale gives each type a
    readable magnitude, and the count beside it carries the other half of the
    story, since the numerous types are not the large ones.

    Args:
        catalogue: Loaded catalogue.
        path: Where to write the figure.
    """
    totals: Counter[str] = Counter()
    counts: Counter[str] = Counter()
    for dataset in catalogue["datasets"]:
        totals[dataset["data_type"]] += dataset["size_bytes"] or 0
        counts[dataset["data_type"]] += 1

    ordered = totals.most_common()
    labels = [name.replace("_", " ") for name, _ in ordered]
    values = [max(value, 1) for _, value in ordered]

    figure, axes = plt.subplots(figsize=(9, 0.6 * len(ordered) + 2.4))
    positions = range(len(ordered))
    axes.barh(list(positions), values, color=SERIES[0], height=0.62)
    axes.set_yticks(list(positions))
    # The count belongs with the name, which leaves only the size to place.
    axes.set_yticklabels(
        [
            f"{label}\n{counts[name]} dataset{'s' if counts[name] != 1 else ''}"
            for label, (name, _) in zip(labels, ordered)
        ]
    )
    axes.invert_yaxis()
    axes.set_xscale("log")
    axes.grid(axis="y", visible=False)
    axes.xaxis.set_major_formatter(
        plt.FuncFormatter(lambda value, _: human_bytes(value))
    )

    # Sizes sit inside their own bar, so nothing hangs outside the axes. A
    # bar too short to hold its label gets it just outside instead, and the
    # axis is widened enough for that to fit.
    biggest = max(values)
    axes.set_xlim(left=min(values) / 3, right=biggest * 2.6)
    for index, (_, value) in enumerate(ordered):
        roomy = value > biggest / 5000
        axes.text(
            value / 1.15 if roomy else value * 1.3,
            index,
            human_bytes(value),
            va="center",
            ha="right" if roomy else "left",
            fontsize=9,
            color=SURFACE if roomy else INK_SECONDARY,
        )

    total = sum(totals.values())
    axes.set_xlabel(
        f"Published bytes, log scale — {human_bytes(total)} across "
        f"{sum(counts.values())} datasets"
    )
    figure.savefig(path, bbox_inches="tight")
    plt.close(figure)


def plot_sizes(catalogue: dict[str, Any], path: Path) -> None:
    """Draw the distribution of published file sizes.

    Args:
        catalogue: Loaded catalogue.
        path: Where to write the figure.
    """
    sizes = [d["size_bytes"] for d in catalogue["datasets"] if d.get("size_bytes")]
    figure, axes = plt.subplots(figsize=(9, 5))
    bins = [10 ** (exponent / 2) for exponent in range(6, 22)]
    axes.hist(sizes, bins=bins, color=SERIES[0], edgecolor=SURFACE, linewidth=2)
    axes.set_xscale("log")
    axes.set_ylabel("Datasets")
    axes.set_xlabel(
        f"File size, {human_bytes(min(sizes))} to {human_bytes(max(sizes))}"
    )
    axes.xaxis.set_major_formatter(
        plt.FuncFormatter(lambda value, _: human_bytes(value))
    )
    axes.grid(axis="x", visible=False)

    figure.savefig(path, bbox_inches="tight")
    plt.close(figure)


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


def plot_timeline(catalogue: dict[str, Any], path: Path) -> None:
    """Draw publication over time as datasets and as bytes.

    Two measures of different scale get two panels sharing one x axis, never
    two y scales on one plot.

    Args:
        catalogue: Loaded catalogue.
        path: Where to write the figure.
    """
    published = []
    for dataset in catalogue["datasets"]:
        stamp = dataset.get("published_at")
        if not stamp:
            continue
        published.append(
            (
                datetime.fromisoformat(stamp.replace("Z", "+00:00")),
                dataset["size_bytes"] or 0,
            )
        )
    published.sort()

    times = [when for when, _ in published]
    counts = list(range(1, len(published) + 1))
    volume, running = [], 0.0
    for _, size in published:
        running += size / 1024**3
        volume.append(running)

    figure, (top, bottom) = plt.subplots(
        2, 1, figsize=(10, 6), sharex=True, gridspec_kw={"hspace": 0.18}
    )
    top.step(times, counts, where="post", color=SERIES[0], linewidth=2)
    top.set_ylabel("Datasets")

    bottom.step(times, volume, where="post", color=SERIES[1], linewidth=2)
    bottom.set_ylabel("Cumulative GiB")
    bottom.set_xlabel("Published")

    for axis in (top, bottom):
        axis.grid(axis="x", visible=False)
    figure.autofmt_xdate()
    figure.savefig(path, bbox_inches="tight")
    plt.close(figure)


def plot_instruments(catalogue: dict[str, Any], path: Path) -> None:
    """Draw the wavelength coverage of every published instrument.

    Args:
        catalogue: Loaded catalogue.
        path: Where to write the figure.
    """
    rows = []
    for detail in catalogue["details"].values():
        release = detail.get("current_release")
        instrument = release.get("instrument") if release else None
        if not instrument or not instrument.get("wavelength_min"):
            continue
        mission = detail["name"].split("-")[0].upper()
        rows.append(
            (
                detail["name"],
                mission,
                instrument["wavelength_min"],
                instrument["wavelength_max"],
                len(instrument.get("filter_codes") or []),
                instrument.get("psfs") is not None,
            )
        )

    missions = [m for m, _ in Counter(row[1] for row in rows).most_common()][:3]
    rows.sort(
        key=lambda row: (missions.index(row[1]) if row[1] in missions else 9, row[2])
    )

    figure, axes = plt.subplots(figsize=(10, max(4, len(rows) * 0.34)))
    # PSF availability rides on the annotation already beside each bar. A
    # marker column or a companion subplot would add a whole chart element
    # for one bit of information that only five rows carry.
    limit = max(row[3] for row in rows) * 1.2
    labels = []
    for index, (name, mission, low, high, filters, has_psfs) in enumerate(rows):
        colour = SERIES[missions.index(mission)] if mission in missions else INK_MUTED
        axes.plot(
            [low, high],
            [index, index],
            color=colour,
            linewidth=6,
            solid_capstyle="round",
        )
        labels.append(
            axes.text(
                high * 1.06,
                index,
                f"{filters} filter{'s' if filters != 1 else ''}"
                + (" · PSFs" if has_psfs else ""),
                va="center",
                fontsize=9,
                color=INK_SECONDARY,
            )
        )

    axes.set_yticks(range(len(rows)))
    axes.set_yticklabels([row[0] for row in rows], fontsize=9)
    axes.set_xscale("log")
    axes.set_xlabel("Wavelength (Å)")
    axes.set_xlim(right=limit)
    axes.grid(axis="y", visible=False)
    axes.set_ylim(len(rows) - 0.5, -0.6)

    for mission, colour in zip(missions, SERIES):
        axes.plot([], [], color=colour, linewidth=4, label=mission)
    # Below the axis, where it cannot cover a mark or a filter count.
    axes.legend(
        loc="upper center",
        bbox_to_anchor=(0.5, -0.06 - 2.4 / (len(rows) + 6)),
        ncol=len(missions),
        labelcolor=INK_SECONDARY,
    )
    fit_labels(figure, axes, labels)
    figure.savefig(path, bbox_inches="tight")
    plt.close(figure)


def stellar_grids(catalogue: dict[str, Any]) -> list[tuple[dict, dict]]:
    """Return grid datasets paired with their grid metadata.

    Args:
        catalogue: Loaded catalogue.

    Returns:
        Pairs of dataset detail and grid metadata, dust grids excluded.
    """
    found = []
    for detail in catalogue["details"].values():
        release = detail.get("current_release") or {}
        grid = release.get("grid")
        if grid and detail["data_type"] == "grid":
            found.append((detail, grid))
    return found


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


PLOTS = {
    "composition": plot_composition,
    "sizes": plot_sizes,
    "wavelengths": plot_wavelengths,
    "models": plot_model_emission,
    "timeline": plot_timeline,
    "instruments": plot_instruments,
    "sps": plot_sps_coverage,
    "cloudy": plot_cloudy,
    "imf": plot_imf,
}


def main() -> None:
    """Render catalogue plots from the command line."""
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--output-dir", type=Path, default=Path("plots"))
    parser.add_argument("--cache", type=Path, default=Path(".catalogue-cache.json"))
    parser.add_argument("--refresh", action="store_true", help="ignore the cache")
    parser.add_argument("--plot", choices=sorted(PLOTS), action="append")
    args = parser.parse_args()

    style()
    catalogue = load_catalogue(args.api_url, args.cache, args.refresh)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for name in args.plot or sorted(PLOTS):
        path = args.output_dir / f"{name}.png"
        PLOTS[name](catalogue, path)
        print(f"  wrote {path}")


if __name__ == "__main__":
    main()
