"""The palette every catalogue plot is drawn in.

Text never wears a series colour, and the grid and axes stay recessive, so
what the eye lands on is always a mark rather than the chrome around it. The
categorical hues are used in a fixed order and never cycled: only the first
three are validated to stay separable under colour-vision deficiency, so a
chart comparing arbitrary pairs may use those three and no more.
"""

from __future__ import annotations

from syndex.plotting import plt

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
