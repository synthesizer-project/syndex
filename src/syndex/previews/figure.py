"""What a preview looks like: the ground, the frame, and the ink.

Every preview is one small PNG shown on a dark page, so the figures are
transparent and the ink is chosen for that ground. `PREVIEW_THEME=light` gives
the same plots for a paper or a talk instead.

The colormap is truncated rather than used whole, and at different ends for
each ground: on white the pale yellow falls below the 3.0 contrast floor, on
the dark page it is the near-black. Both truncations are measured, so a colour
is always distinguishable from what it sits on.
"""

from __future__ import annotations

import io
import os

import matplotlib.ticker
import numpy as np

from syndex.plotting import matplotlib, plt

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


def colour(fraction: float):
    """Map 0-1 onto the part of the colormap that is visible on this ground.

    Args:
        fraction: Position along the ramp, 0 for the first visible colour.

    Returns:
        An RGBA tuple.
    """
    return CMAP(CMAP_FLOOR + (CMAP_CEILING - CMAP_FLOOR) * fraction)


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
