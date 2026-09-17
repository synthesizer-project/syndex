"""Tests for opening a file and reading what it says about itself.

What is checked here is the reading, not the deciding: that the right value
comes out of the right attribute, that a singular axis name or a Cloudy
version disagreeing with the filename is noticed, and that a file the tools
do not recognise is left alone rather than guessed at.
"""

from pathlib import Path

import pytest

from samples import (
    make_grid,
    make_ifu_full,
    make_instrument_collection,
    make_photometric_imager,
    make_photometric_imager_full,
    make_real_collection,
    make_spectroscopic_full,
)
from syndex.inspection import (
    check_axis_conventions,
    check_photoionisation_version,
    detect_format,
    extract_hdf5,
    extract_instrument_hdf5,
)


@pytest.mark.parametrize(
    ("filename", "content", "expected"),
    [
        ("image.fits", b"SIMPLE  = test", "fits"),
        ("values.npz", b"PK\x03\x04payload", "npz"),
        ("archive.gz", b"\x1f\x8bpayload", "gzip"),
    ],
)
def test_content_format_detection(tmp_path, filename, content, expected):
    path = tmp_path / filename
    path.write_bytes(content)

    assert detect_format(path) == expected


def test_an_unknown_suffix_is_not_treated_as_a_format(tmp_path):
    """Raw model inputs are named for their contents, not their format."""
    text_file = tmp_path / "sed.ssz002.rhb"
    text_file.write_text("1.0 2.0 3.0\n4.0 5.0 6.0\n")
    binary_file = tmp_path / "model.weights"
    binary_file.write_bytes(bytes(range(200, 256)) * 4)

    assert detect_format(text_file) == "text"
    assert detect_format(binary_file) == "binary"


def test_grid_extraction_reads_metadata_not_spectra(tmp_path):
    path = tmp_path / "grid.hdf5"
    make_grid(path)

    result = extract_hdf5(path)

    assert result["available_spectra"] == ["incident"]
    assert result["axes"][0]["values"] == [1.0, 10.0]
    assert result["axes"][0]["scale"] == "log"
    assert "spectra" not in result


def test_photometric_imager_extraction(tmp_path):
    path = tmp_path / "instrument.hdf5"
    make_photometric_imager(path)

    result = extract_instrument_hdf5(path)

    assert result["instrument_type"] == "photometric_imager"
    assert result["filter_codes"] == ["Test/A", "Test/B"]
    assert result["wavelength"]["minimum"] == 1000.0
    assert result["wavelength"]["maximum"] == 3000.0
    assert result["resolution"] == {"value": 0.1, "units": "arcsec"}


def test_photometric_imager_full_extraction(tmp_path):
    path = tmp_path / "instrument.hdf5"
    make_photometric_imager_full(path)

    result = extract_instrument_hdf5(path)

    assert result["capabilities"] == {
        "can_do_photometry": True,
        "can_do_imaging": True,
        "can_do_psf_imaging": True,
        "can_do_noisy_imaging": True,
        "can_do_spectroscopy": False,
        "can_do_noisy_spectroscopy": False,
        "can_do_resolved_spectroscopy": False,
        "can_do_psf_spectroscopy": False,
        "can_do_noisy_resolved_spectroscopy": False,
    }
    assert result["depth"] == {
        "kind": "per_key",
        "values": {
            "Test/A": {"value": 28.0, "units": "AB_mag"},
            "Test/B": {"value": 29.0, "units": "AB_mag"},
        },
    }
    assert result["snrs"] == {"kind": "scalar", "value": 10.0, "units": "dimensionless"}
    assert result["psfs"]["kind"] == "per_key"
    assert set(result["psfs"]["keys"]) == {"Test/A", "Test/B"}
    assert result["psfs"]["keys"]["Test/A"] == {
        "shape": [4, 4],
        "units": "dimensionless",
    }
    assert result["psf_resample_factor"] == 2
    assert set(result["noise_maps"]["keys"]) == {"Test/A", "Test/B"}
    assert result["noise_maps"]["keys"]["Test/A"]["shape"] == [4, 4]


def test_spectroscopic_full_extraction(tmp_path):
    path = tmp_path / "instrument.hdf5"
    make_spectroscopic_full(path)

    result = extract_instrument_hdf5(path)

    assert result["instrument_type"] == "spectroscopic"
    assert result["capabilities"]["can_do_spectroscopy"] is True
    assert result["capabilities"]["can_do_imaging"] is False
    assert result["resolution"] is None
    assert result["resolving_power"] == 1000.0
    assert result["depth"] == {"kind": "scalar", "value": 25.0, "units": "AB_mag"}
    assert result["snrs"] == {"kind": "scalar", "value": 5.0, "units": "dimensionless"}


def test_ifu_full_extraction(tmp_path):
    path = tmp_path / "instrument.hdf5"
    make_ifu_full(path)

    result = extract_instrument_hdf5(path)

    assert result["instrument_type"] == "ifu"
    assert result["capabilities"]["can_do_resolved_spectroscopy"] is True
    assert result["capabilities"]["can_do_imaging"] is False
    assert result["resolution"] == {"value": 0.05, "units": "arcsec"}
    assert result["resolving_power"] == 500.0
    assert result["psfs"] == {
        "kind": "single",
        "shape": [4, 4, 2],
        "units": "dimensionless",
    }


def test_real_collection_layout_extraction(tmp_path):
    path = tmp_path / "collection.hdf5"
    make_real_collection(path)

    result = extract_instrument_hdf5(path)

    assert result["instrument_type"] == "collection"
    assert set(result["members"]) == {"TestImagerFull", "TestSpectrograph"}
    assert result["members"]["TestImagerFull"]["instrument_type"] == (
        "photometric_imager"
    )
    assert result["members"]["TestSpectrograph"]["instrument_type"] == ("spectroscopic")


def test_instrument_collection_extraction(tmp_path):
    path = tmp_path / "collection.hdf5"
    make_instrument_collection(path)

    result = extract_instrument_hdf5(path)

    assert result["instrument_type"] == "collection"
    assert set(result["members"]) == {"A", "B"}
    assert result["members"]["A"]["instrument_type"] == "spectroscopic"


def test_singular_axis_names_are_reported():
    """The plural convention is what the catalogue and Synthesizer both use."""
    warnings = check_axis_conventions(
        [
            {"name": "mass", "units": "kg"},
            {"name": "accretion_rate_eddington", "units": "dimensionless"},
        ]
    )
    assert len(warnings) == 2
    assert "masses" in warnings[0]
    assert "accretion_rates_eddington" in warnings[1]


def test_compound_units_are_not_mistaken_for_the_base_unit():
    """'yr**2' shares a prefix with 'yr' and must not pass as a time unit."""
    (warning,) = check_axis_conventions([{"name": "ages", "units": "yr**2"}])
    assert "yr**2" in warning


def test_conventional_axes_produce_no_warnings():
    assert (
        check_axis_conventions(
            [
                {"name": "ages", "units": "yr"},
                {"name": "metallicities", "units": "dimensionless"},
                {"name": "masses", "units": "kg"},
            ]
        )
        == []
    )


def test_unknown_axes_are_left_alone():
    """A new axis must not be blocked by a list that has not heard of it."""
    assert check_axis_conventions([{"name": "qpah", "units": "dimensionless"}]) == []
    assert check_axis_conventions([{"name": "alpha", "units": "dimensionless"}]) == []


def test_filename_and_recorded_cloudy_version_must_agree():
    """The defect that made three c25.00 grids look like c23.01 ones."""
    (warning,) = check_photoionisation_version(
        Path("bpass_cloudy-c25.00-sps.hdf5"), "c23.01"
    )
    assert "c25.00" in warning and "c23.01" in warning


def test_a_missing_c_prefix_is_not_a_disagreement():
    """One grid recorded '23.01'; that is a spelling difference, not a bug."""
    assert (
        check_photoionisation_version(Path("bpass_cloudy-c23.01-sps.hdf5"), "23.01")
        == []
    )


def test_filenames_without_a_cloudy_version_are_ignored():
    assert (
        check_photoionisation_version(Path("maraston24-Te00_kroupa.hdf5"), "c23.01")
        == []
    )
