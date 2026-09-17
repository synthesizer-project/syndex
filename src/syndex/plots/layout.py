"""Fitting marks and words into the space a chart has.

Geometry with no matplotlib in it: a treemap that has to fill a rectangle
exactly, and the rule for when a label is too big for the box it names.
Separated because both are the kind of thing that is worth reading on its own
before believing a picture drawn with it.
"""

from __future__ import annotations

import math


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
