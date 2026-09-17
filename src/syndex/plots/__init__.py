"""Diagnostic plots of the published catalogue.

Reads the public API rather than D1, so the plots describe exactly what a
client sees, and caches the responses so repeated runs are instant.

    uv run syndex-plots --output-dir plots
    uv run syndex-plots --plot wavelengths --refresh

Each module here is a group of plots that answer one kind of question, over a
catalogue loaded once by `api`, drawn in the palette `palette` sets. `cli` is
the command.
"""
