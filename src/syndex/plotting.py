"""Importing matplotlib, and what to say when it is not installed.

Both plotting commands come through here, which is what guarantees the
headless backend is selected before anything imports pyplot -- do that in the
wrong order and the first plot on a machine with no display is a crash rather
than a PNG.

Not to be confused with `plots/`, which draws the catalogue diagnostics, or
`previews/`, which draws one figure per file. This is only the import.
"""

from __future__ import annotations

try:
    import matplotlib
except ModuleNotFoundError as error:  # pragma: no cover - depends on the install
    # A console script that answers a missing optional dependency with a
    # traceback is one nobody can act on. Plotting is an extra because a
    # contributor checking one file should not have to install it.
    raise SystemExit(
        "This command needs the plotting extra:\n    pip install 'cosmos-syndex[plots]'"
    ) from error

# Before pyplot, and this is the only place that imports pyplot at all.
matplotlib.use("Agg")

import matplotlib.pyplot as plt

__all__ = ["matplotlib", "plt"]
