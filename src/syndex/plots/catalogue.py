"""What the catalogue is, as a whole.

How the volume divides by type, how the file sizes are spread, and how both
grew. These are the plots that answer "what is in there" rather than "what do
the grids cover", which is `coverage.py`.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from syndex.plots.layout import human_bytes
from syndex.plots.palette import INK_SECONDARY, SERIES, SURFACE
from syndex.plotting import plt


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
