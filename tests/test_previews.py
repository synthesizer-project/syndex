import io
from pathlib import Path

import h5py
import numpy as np
import pytest

from syndex import previews


class FakeBody:
    def __init__(self, data: bytes):
        self._data = data

    def read(self) -> bytes:
        return self._data


class FakeR2:
    """An S3 client over a bytes object, counting the ranges it serves."""

    def __init__(self, payload: bytes):
        self.payload = payload
        self.ranges: list[tuple[int, int]] = []

    def get_object(self, Bucket, Key, Range):
        start, end = (int(part) for part in Range.removeprefix("bytes=").split("-"))
        self.ranges.append((start, end))
        return {"Body": FakeBody(self.payload[start : end + 1])}


def test_r2file_reads_across_block_boundaries():
    payload = bytes(range(256)) * 400  # 102,400 bytes
    client = FakeR2(payload)
    handle = previews.R2File(client, "bucket", "key", len(payload))
    handle.BLOCK = 4096

    reader = io.BufferedReader(handle, buffer_size=1024)
    reader.seek(4000)
    assert reader.read(200) == payload[4000:4200]
    reader.seek(len(payload) - 10)
    assert reader.read(50) == payload[-10:]
    assert reader.read(1) == b""
    assert handle.fetched == sum(end - start + 1 for start, end in client.ranges)


def test_r2file_serves_repeat_reads_from_cache():
    payload = b"x" * 20_000
    client = FakeR2(payload)
    handle = previews.R2File(client, "bucket", "key", len(payload))
    handle.BLOCK = 4096

    for _ in range(5):
        handle.seek(100)
        assert handle.read(10) == b"x" * 10
    assert len(client.ranges) == 1


def test_r2file_clamps_seeks_to_the_object():
    handle = previews.R2File(FakeR2(b"abc"), "bucket", "key", 3)
    assert handle.seek(-100) == 0
    assert handle.seek(100) == 3
    assert handle.seek(-1, io.SEEK_END) == 2


def test_reduce_lam_keeps_the_endpoints():
    lam = np.logspace(1, 5, 5000)
    keep = previews.reduce_lam(lam, count=100)
    assert keep[0] == 0
    assert keep[-1] == lam.size - 1
    assert keep.size <= 100
    assert np.all(np.diff(keep) > 0)
    short = np.arange(7.0)
    assert np.array_equal(previews.reduce_lam(short, count=100), np.arange(7))


def test_mesh_edges_bracket_the_samples():
    values = np.array([1.0, 2.0, 3.0])
    low, high = previews._mesh_edges(values, log=False)
    assert (low, high) == (0.5, 3.5)

    values = np.array([1.0, 10.0, 100.0])
    low, high = previews._mesh_edges(values, log=True)
    assert low == pytest.approx(10**-0.5)
    assert high == pytest.approx(10**2.5)

    low, high = previews._mesh_edges(np.array([5.0]), log=False)
    assert low < 5.0 < high
    # A single sample sitting at zero still has to produce a real interval.
    low, high = previews._mesh_edges(np.array([0.0]), log=False)
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
        figure, reason = previews.spectra_preview(hdf, "grid")
    assert reason is None
    axes = figure.axes[0]
    assert axes.get_ylabel().startswith("transmitted + nebular")
    floor, ceiling = axes.get_ylim()
    assert 0 < floor < ceiling
    png = previews.render_png(figure)
    assert png.startswith(b"\x89PNG")


def test_spectra_preview_omits_rather_than_plotting_zeros(tmp_path):
    lam = np.logspace(2, 5, 50)
    path = tmp_path / "zero.hdf5"
    grid(path, lam=lam, spectra={"incident": np.zeros((2, lam.size))})
    with h5py.File(path, "r") as hdf:
        figure, reason = previews.spectra_preview(hdf, "zero")
    assert figure is None
    assert "zero" in reason


def test_spectra_preview_survives_a_single_wavelength(tmp_path):
    path = tmp_path / "one.hdf5"
    grid(path, lam=np.array([5000.0]), spectra={"incident": np.ones((2, 1))})
    with h5py.File(path, "r") as hdf:
        figure, reason = previews.spectra_preview(hdf, "one")
    if figure is not None:
        floor, ceiling = figure.axes[0].get_ylim()
        assert np.isfinite([floor, ceiling]).all() and floor < ceiling
        previews.render_png(figure)
    else:
        assert reason


def test_choose_dispatches_on_the_catalogue_row(tmp_path):
    path = tmp_path / "grid.hdf5"
    grid(path, lam=np.array([1.0, 2.0]), spectra={"incident": np.ones((2, 2))})
    with h5py.File(path, "r") as hdf:
        assert previews.choose(hdf, {"data_type": "instrument"}) is (
            previews.filters_preview
        )
        assert previews.choose(hdf, {"data_type": "dust_grid"}) is (
            previews.dust_preview
        )
        assert previews.choose(hdf, {"data_type": "archive"}) is None
        assert previews.choose(hdf, {"data_type": "grid", "has_spectra": 1}) is (
            previews.spectra_preview
        )
        # A grid with no spectra and no ionising luminosity gets no image at
        # all, which is the honest answer rather than an empty frame.
        assert previews.choose(hdf, {"data_type": "grid", "has_spectra": 0}) is None


def test_every_plotter_choose_returns_has_a_preview_kind():
    plotters = {
        previews.filters_preview,
        previews.dust_preview,
        previews.spectra_preview,
        previews.ionising_preview,
    }
    assert {p.__name__ for p in plotters} <= set(previews.PREVIEW_KINDS)
    # migration 0007 constrains files.preview_kind to exactly these.
    assert set(previews.PREVIEW_KINDS.values()) == {"spectra", "filters", "ionising"}


def test_make_preview_skips_unplottable_types_without_opening_the_file():
    reason = previews.make_preview(
        None, "bucket", {"data_type": "archive", "name": "x", "size_bytes": 1}
    )
    assert reason == "archive has no indicative plot"
