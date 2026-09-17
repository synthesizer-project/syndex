"""The `syndex-plots` command.

Nine plots, each a function taking the loaded catalogue and a path. The
registry below is what `--plot` chooses from, so adding a plot is adding one
function and one line here.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from syndex.plots.api import DEFAULT_API_URL, load_catalogue
from syndex.plots.catalogue import plot_composition, plot_sizes, plot_timeline
from syndex.plots.coverage import (
    plot_cloudy,
    plot_imf,
    plot_model_emission,
    plot_sps_coverage,
    plot_wavelengths,
)
from syndex.plots.instruments import plot_instruments
from syndex.plots.palette import style

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
    # Written out rather than taken from `__doc__`: this is what somebody
    # reading `--help` sees, and this module's docstring is written for
    # somebody reading the module.
    parser = argparse.ArgumentParser(
        prog="syndex-plots",
        description=(
            "Draw diagnostic plots of the published catalogue. Everything is "
            "read through the public API, so the plots describe exactly what a "
            "client sees, and the responses are cached: pass --refresh to "
            "fetch them again."
        ),
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
