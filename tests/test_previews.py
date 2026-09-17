"""Tests for choosing a preview and drawing it.

Every one of these is about a file that would otherwise get a misleading
picture: a grid whose spectra are all zero, one with a single wavelength, one
carrying no spectra at all. The rule being held to is that a file with nothing
to show gets no image and a reason, never an empty frame.
"""

from pathlib import Path

import h5py
import numpy as np
import pytest

from syndex.previews.figure import reduce_lam, render_png
from syndex.previews.kinds import (
    PREVIEW_KINDS,
    _mesh_edges,
    choose,
    dust_preview,
    filters_preview,
    ionising_preview,
    make_preview,
    spectra_preview,
)


def test_reduce_lam_keeps_the_endpoints():
    lam = np.logspace(1, 5, 5000)
    keep = reduce_lam(lam, count=100)
    assert keep[0] == 0
    assert keep[-1] == lam.size - 1
    assert keep.size <= 100
    assert np.all(np.diff(keep) > 0)
    short = np.arange(7.0)
    assert np.array_equal(reduce_lam(short, count=100), np.arange(7))


def test_mesh_edges_bracket_the_samples():
    values = np.array([1.0, 2.0, 3.0])
    low, high = _mesh_edges(values, log=False)
    assert (low, high) == (0.5, 3.5)

    values = np.array([1.0, 10.0, 100.0])
    low, high = _mesh_edges(values, log=True)
    assert low == pytest.approx(10**-0.5)
    assert high == pytest.approx(10**2.5)

    low, high = _mesh_edges(np.array([5.0]), log=False)
    assert low < 5.0 < high
    # A single sample sitting at zero still has to produce a real interval.
    low, high = _mesh_edges(np.array([0.0]), log=False)
    assert low < high


def grid(path: Path, *, spectra: dict[str, np.ndarray], lam: np.ndarray) -> None:
    with h5py.File(path, "w") as hdf:
        hdf.attrs["axes"] = ["age", "metallicity"]
        group = hdf.create_group("spectra")
        group.create_dataset("wavelength", data=lam)
        for name, values in spectra.items():
            dataset = group.create_dataset(name, data=values)
            dataset.attrs["Units"] = "erg/s/Hz"


def test_spectra_preview_plots_transmitted_plus_nebular(tmp_path):
    lam = np.logspace(2, 5, 400)
    shape = (3, 4, lam.size)
    path = tmp_path / "grid.hdf5"
    grid(
        path,
        lam=lam,
        spectra={
            "transmitted": np.exp(-((np.log10(lam) - 3) ** 2)) * np.ones(shape),
            "nebular": np.full(shape, 1e-3),
        },
    )
    with h5py.File(path, "r") as hdf:
        figure, reason = spectra_preview(hdf, "grid")
    assert reason is None
    axes = figure.axes[0]
    assert axes.get_ylabel().startswith("transmitted + nebular")
    floor, ceiling = axes.get_ylim()
    assert 0 < floor < ceiling
    png = render_png(figure)
    assert png.startswith(b"\x89PNG")


def test_spectra_preview_omits_rather_than_plotting_zeros(tmp_path):
    lam = np.logspace(2, 5, 50)
    path = tmp_path / "zero.hdf5"
    grid(path, lam=lam, spectra={"incident": np.zeros((2, lam.size))})
    with h5py.File(path, "r") as hdf:
        figure, reason = spectra_preview(hdf, "zero")
    assert figure is None
    assert "zero" in reason


def test_spectra_preview_survives_a_single_wavelength(tmp_path):
    path = tmp_path / "one.hdf5"
    grid(path, lam=np.array([5000.0]), spectra={"incident": np.ones((2, 1))})
    with h5py.File(path, "r") as hdf:
        figure, reason = spectra_preview(hdf, "one")
    if figure is not None:
        floor, ceiling = figure.axes[0].get_ylim()
        assert np.isfinite([floor, ceiling]).all() and floor < ceiling
        render_png(figure)
    else:
        assert reason


def test_choose_dispatches_on_the_catalogue_row(tmp_path):
    path = tmp_path / "grid.hdf5"
    grid(path, lam=np.array([1.0, 2.0]), spectra={"incident": np.ones((2, 2))})
    with h5py.File(path, "r") as hdf:
        assert choose(hdf, {"data_type": "instrument"}) is (filters_preview)
        assert choose(hdf, {"data_type": "dust_grid"}) is (dust_preview)
        assert choose(hdf, {"data_type": "archive"}) is None
        assert choose(hdf, {"data_type": "grid", "has_spectra": 1}) is (spectra_preview)
        # A grid with no spectra and no ionising luminosity gets no image at
        # all, which is the honest answer rather than an empty frame.
        assert choose(hdf, {"data_type": "grid", "has_spectra": 0}) is None


def test_every_plotter_choose_returns_has_a_preview_kind():
    plotters = {
        filters_preview,
        dust_preview,
        spectra_preview,
        ionising_preview,
    }
    assert {p.__name__ for p in plotters} <= set(PREVIEW_KINDS)
    # migration 0007 constrains files.preview_kind to exactly these.
    assert set(PREVIEW_KINDS.values()) == {"spectra", "filters", "ionising"}


def test_make_preview_skips_unplottable_types_without_opening_the_file():
    reason = make_preview(
        None, "bucket", {"data_type": "archive", "name": "x", "size_bytes": 1}
    )
    assert reason == "archive has no indicative plot"
