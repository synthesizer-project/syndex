"""What the instruments cover.

One plot, because an instrument is described by two numbers a reader cares
about -- where it looks and how many filters it has -- and putting them on one
pair of axes is the whole of it.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from syndex.plots.layout import fit_labels
from syndex.plots.palette import INK_MUTED, INK_SECONDARY, SERIES
from syndex.plotting import plt


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
