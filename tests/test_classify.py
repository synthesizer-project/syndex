"""Tests for classification.

What matters here is what a file is taken to be, and nothing about whether it
is fit to publish -- that is `test_check.py`. The cases worth pinning are the
three outcomes classification can reach: a type read out of the file, a file
whose layout identifies nothing, and a file that cannot be read at all.
"""

from pathlib import Path

import h5py
import numpy as np
import pytest

from samples import (
    make_dust_extinction_grid,
    make_grid,
    make_photometric_imager,
)
from syndex import classify as classify_module
from syndex.classify import classify


def make_photoionised_grid(path: Path) -> None:
    """Write a grid that is classifiable: an SPS model run through Cloudy."""
    with h5py.File(path, "w") as hdf:
        hdf.attrs["axes"] = ["ages", "metallicities"]
        hdf.attrs["synthesizer_version"] = "1.0.0"
        axes = hdf.create_group("axes")
        ages = axes.create_dataset("ages", data=[1.0e6, 1.0e7])
        ages.attrs["Units"] = "yr"
        metallicities = axes.create_dataset("metallicities", data=[0.01, 0.02])
        metallicities.attrs["Units"] = "dimensionless"
        spectra = hdf.create_group("spectra")
        wavelength = spectra.create_dataset("wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["Units"] = "angstrom"
        spectra.create_dataset("incident", data=np.ones((2, 2, 2)))
        spectra.create_dataset("nebular", data=np.ones((2, 2, 2)))
        model = hdf.create_group("Model")
        model.attrs["sps_name"] = "BPASS"
        model.attrs["sps_version"] = "2.2.1"
        cloudy = hdf.create_group("CloudyParams")
        cloudy.attrs["cloudy_version"] = "c23.01"


def test_every_detectable_type_is_a_catalogue_type():
    """Classification cannot invent a type the catalogue does not store."""
    assert set(classify_module.DETECTABLE_TYPES) <= set(classify_module.DATA_TYPES)


def test_photoionised_grid(tmp_path):
    """An SPS grid is read as a grid, with its model named."""
    path = tmp_path / "bpass-cloudy-c23.01.hdf5"
    make_photoionised_grid(path)

    result = classify(path)

    assert result.data_type == "grid"
    assert result.file_format == "hdf5"
    assert result.error is None
    assert "BPASS" in result.reason
    assert result.summary["grid_type"] == "sps"
    assert result.summary["emission_type"] == "photoionised"
    assert result.summary["model_name"] == "BPASS"
    assert [axis["name"] for axis in result.summary["axes"]] == [
        "ages",
        "metallicities",
    ]
    # The extracted payload is what the checks read, and is kept whole.
    assert result.extracted["available_spectra"] == ["incident", "nebular"]


def test_dust_grid_is_its_own_type(tmp_path):
    """Extinction curves are a dust grid, not a grid."""
    path = tmp_path / "dust-curves.hdf5"
    make_dust_extinction_grid(path)

    result = classify(path)

    assert result.data_type == "dust_grid"
    assert result.summary["grid_type"] == "dust"
    assert result.summary["emission_type"] == "dust_attenuation"
    assert "dust" in result.reason


def test_grid_with_no_model_is_still_a_grid(tmp_path):
    """Classification reports the type it can see, and leaves the rest to checks."""
    # make_grid writes a Model group with only a "name" attribute, which is
    # neither an SPS name nor a declared type. It is recognisably a grid; what
    # kind of grid is a question the checks answer.
    path = tmp_path / "mystery.hdf5"
    make_grid(path)

    result = classify(path)

    assert result.data_type == "grid"
    assert result.summary["grid_type"] is None
    assert "nothing identifying which kind" in result.reason
    assert result.error is None


def test_instrument(tmp_path):
    """An instrument cache is recognised without being mistaken for a grid."""
    path = tmp_path / "instrument.hdf5"
    make_photometric_imager(path)

    result = classify(path)

    assert result.data_type == "instrument"
    assert result.summary["instrument_type"] == "photometric_imager"
    assert result.summary["filters"] == 2
    assert "can_do_photometry" in result.summary["capabilities"]


def test_unrecognised_hdf5_has_no_type(tmp_path):
    """HDF5 that is neither grid nor instrument is left for a reviewer."""
    path = tmp_path / "simulation.hdf5"
    with h5py.File(path, "w") as hdf:
        hdf.create_dataset("particles", data=np.ones(10))

    result = classify(path)

    assert result.data_type is None
    assert result.error is None
    assert "neither a Synthesizer grid nor an instrument cache" in result.reason


def test_non_hdf5_has_no_type(tmp_path):
    """A format with no layout identifies nothing, and that is not an error."""
    path = tmp_path / "notes.txt"
    path.write_text("a description of some simulation output")

    result = classify(path)

    assert result.data_type is None
    assert result.file_format == "txt"
    assert result.error is None


def test_truncated_hdf5_records_an_error(tmp_path):
    """Unreadable bytes are found here, not left to a check that never runs."""
    path = tmp_path / "truncated.hdf5"
    make_photoionised_grid(path)
    whole = path.read_bytes()
    path.write_bytes(whole[: len(whole) // 2])

    result = classify(path)

    assert result.data_type is None
    assert result.error is not None
    assert "truncated or corrupt" in result.error


def test_missing_file_raises(tmp_path):
    """A path that is not there is the caller's mistake, not a classification."""
    with pytest.raises(FileNotFoundError):
        classify(tmp_path / "absent.hdf5")


def test_extractor_warnings_are_not_printed(tmp_path, capsys):
    """Classification is quiet; reporting the warnings belongs to the checks."""
    path = tmp_path / "singular.hdf5"
    make_grid(path)

    classify(path)

    assert capsys.readouterr().err == ""
