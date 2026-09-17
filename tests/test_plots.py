"""A smoke test for the catalogue plots: every one of them draws something.

None of these assert what a plot looks like -- a figure is not a thing a test
can usefully read -- so what is held here is the part that does break: that
every plot in the registry still runs against the shape the API returns, and
writes a PNG rather than raising on a field that moved or a group that turned
out to be empty.

The catalogue is built by hand, and deliberately awkward: one grid with no
model name, one with no photoionisation, an instrument with no PSFs. Those are
the rows that have broken a plot before.
"""

import pytest

from syndex.plots.api import grids, stellar_grids
from syndex.plots.cli import PLOTS
from syndex.plots.layout import human_bytes, squarify
from syndex.plots.palette import style


def dataset(name, data_type, size, published_at, release):
    """One entry as the API returns it, in both of the shapes it comes in."""
    return (
        {
            "name": name,
            "data_type": data_type,
            "size_bytes": size,
            "published_at": published_at,
        },
        {
            "name": name,
            "data_type": data_type,
            "size_bytes": size,
            "published_at": published_at,
            "current_release": release,
        },
    )


GRID = {
    "grid": {
        "grid_type": "sps",
        "emission_type": "photoionised",
        "model_name": "BPASS",
        "wavelength_min": 1.0,
        "wavelength_max": 1.0e5,
        "wavelength_units": "Å",
        "photoionisation_code": "Cloudy",
        "photoionisation_code_version": "23.01",
        "photoionisation_parameters": {
            "ionisation_parameter": [-2.0, -3.0],
            "hydrogen_density": [100.0],
        },
        "model_parameters": {
            "imf_type": "Chabrier",
            "imf_masses": [0.1, 300.0],
            "imf_slopes": [2.35],
        },
        "axes": [
            {"name": "ages", "minimum": 1e6, "maximum": 1e10, "count": 51},
            {"name": "metallicities", "minimum": 1e-5, "maximum": 0.04, "count": 13},
        ],
    }
}

# A grid the plots have to cope with rather than one they were written for:
# no model name, no photoionisation, no model parameters, micron wavelengths.
SPARSE_GRID = {
    "grid": {
        "grid_type": "agn",
        "emission_type": "incident",
        "model_name": None,
        "wavelength_min": 0.1,
        "wavelength_max": 10.0,
        "wavelength_units": "μm",
        "axes": [],
    }
}

DUST_GRID = {
    "grid": {
        "grid_type": "dust",
        "emission_type": "emission",
        "model_name": "Draine",
        "wavelength_min": 100.0,
        "wavelength_max": 1.0e7,
        "wavelength_units": "Å",
    }
}

INSTRUMENT = {
    "instrument": {
        "wavelength_min": 6000.0,
        "wavelength_max": 50000.0,
        "filter_codes": ["JWST/NIRCam.F090W", "JWST/NIRCam.F200W"],
        "psfs": None,
        "label": "JWST/NIRCam",
    }
}


@pytest.fixture
def catalogue():
    """A catalogue of four datasets, covering every branch the plots take."""
    rows = [
        dataset("bpass-cloudy", "grid", 2_000_000_000, "2026-01-01T00:00:00Z", GRID),
        dataset(
            "agn-incident", "grid", 500_000_000, "2026-02-01T00:00:00Z", SPARSE_GRID
        ),
        dataset(
            "draine-dust", "dust_grid", 40_000_000, "2026-03-01T00:00:00Z", DUST_GRID
        ),
        dataset(
            "jwst-nircam", "instrument", 3_000_000, "2026-04-01T00:00:00Z", INSTRUMENT
        ),
    ]
    return {
        "datasets": [summary for summary, _ in rows],
        "details": {detail["name"]: detail for _, detail in rows},
    }


@pytest.mark.parametrize("name", sorted(PLOTS))
def test_every_registered_plot_draws_a_png(name, catalogue, tmp_path):
    """The registry is what --plot offers, so every entry has to work."""
    style()
    path = tmp_path / f"{name}.png"
    PLOTS[name](catalogue, path)

    assert path.exists(), f"{name} wrote nothing"
    # A PNG, not an empty file or an error page: the first eight bytes say so.
    assert path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_the_selectors_only_return_what_they_promise(catalogue):
    """`grids` includes dust grids and `stellar_grids` does not."""
    assert {d["name"] for d in grids(catalogue)} == {
        "bpass-cloudy",
        "agn-incident",
        "draine-dust",
    }
    assert {d["name"] for d, _ in stellar_grids(catalogue)} == {
        "bpass-cloudy",
        "agn-incident",
    }


def test_a_treemap_fills_its_rectangle(catalogue):
    """Every tile inside the frame, and the areas in proportion."""
    tiles = squarify([50.0, 30.0, 20.0], 0.0, 0.0, 10.0, 10.0)

    assert len(tiles) == 3
    for x, y, width, height in tiles:
        assert x >= -1e-9 and y >= -1e-9
        assert x + width <= 10.0 + 1e-9 and y + height <= 10.0 + 1e-9
    biggest = max(tiles, key=lambda t: t[2] * t[3])
    assert biggest[2] * biggest[3] == pytest.approx(50.0, rel=1e-6)


def test_sizes_are_written_the_way_a_download_reports_them():
    """Two significant figures at most, and a unit somebody recognises."""
    assert human_bytes(512) == "512 B"
    assert human_bytes(2 * 1024**2) == "2 MB"
    assert human_bytes(3.5 * 1024**3) == "3.5 GB"
