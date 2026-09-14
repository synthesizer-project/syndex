"""Tests for the verdict.

Classification is covered by `test_classify.py`; these check that the right
rules are applied to what it found, and that the three outcomes stay distinct
-- a file that is ready, a file nobody can categorise, and a file that cannot
be published.
"""

import json

import h5py
import numpy as np
from test_classify import make_photoionised_grid
from test_upload import make_dust_extinction_grid, make_grid, make_photometric_imager

from syndex import check as check_module
from syndex.check import check, check_file
from syndex.classify import DETECTABLE_TYPES, Classification, classify


def test_checks_exist_for_every_detectable_type():
    """A type classification can detect is a type with rules to apply."""
    assert set(DETECTABLE_TYPES) == set(check_module.CHECKS)


def test_complete_grid_passes(tmp_path):
    """A grid carrying everything the schema needs is cleared."""
    path = tmp_path / "bpass-cloudy-c23.01.hdf5"
    make_photoionised_grid(path)

    report = check_file(path)

    assert report.state == "passed"
    assert report.ok
    assert report.errors == []
    assert report.data_type == "grid"


def test_unclassifiable_grid_fails(tmp_path):
    """A grid naming no model and no emission cannot be published."""
    path = tmp_path / "mystery.hdf5"
    make_grid(path)

    report = check_file(path)

    assert report.state == "failed"
    assert not report.ok
    assert any("what kind of grid" in error for error in report.errors)
    assert any("what emission" in error for error in report.errors)


def test_singular_axis_names_warn_but_do_not_block(tmp_path):
    """A broken convention is reported without blocking publication."""
    path = tmp_path / "singular.hdf5"
    make_photoionised_grid(path)
    with h5py.File(path, "r+") as hdf:
        hdf.attrs["axes"] = ["age", "metallicities"]
        hdf.move("axes/ages", "axes/age")

    report = check_file(path)

    assert report.state == "passed"
    assert any("singular" in warning for warning in report.warnings)


def test_cloudy_version_disagreeing_with_filename_warns(tmp_path):
    """The filename and the recorded version are compared, as at publish time."""
    path = tmp_path / "bpass-cloudy-c25.00.hdf5"
    make_photoionised_grid(path)

    report = check_file(path)

    assert report.state == "passed"
    assert any("c25.00" in warning for warning in report.warnings)


def test_dust_grid_gets_the_grid_checks(tmp_path):
    """Both grid types route to the same rules."""
    path = tmp_path / "dust-curves.hdf5"
    make_dust_extinction_grid(path)

    report = check_file(path)

    assert report.data_type == "dust_grid"
    assert report.ok


def test_instrument_gets_the_instrument_checks(tmp_path):
    """An instrument is judged against the instruments table, not the grid tables."""
    path = tmp_path / "instrument.hdf5"
    make_photometric_imager(path)

    report = check_file(path)

    assert report.state == "passed"
    assert report.data_type == "instrument"


def test_empty_instrument_collection_fails():
    """A collection with no members has nothing to publish."""
    classification = Classification(
        filename="empty.hdf5",
        size_bytes=1024,
        file_format="hdf5",
        data_type="instrument",
        extracted={"instrument_type": "collection", "members": {}},
    )

    report = check(classification)

    assert report.state == "failed"
    assert any("holds no instruments" in error for error in report.errors)


def test_unknown_instrument_type_fails():
    """A type the schema's CHECK constraint would reject is caught here first."""
    classification = Classification(
        filename="odd.hdf5",
        size_bytes=1024,
        file_format="hdf5",
        data_type="instrument",
        extracted={"instrument_type": "interferometer"},
    )

    report = check(classification)

    assert report.state == "failed"
    assert any("unrecognised instrument type" in error for error in report.errors)


def test_uncategorised_file_is_ambiguous_not_failed(tmp_path):
    """A file with no rules to apply needs a human, and that is not a failure."""
    path = tmp_path / "simulation.hdf5"
    with h5py.File(path, "w") as hdf:
        hdf.create_dataset("particles", data=np.ones(10))

    report = check_file(path)

    assert report.state == "ambiguous"
    assert report.ok
    assert any("reviewer will categorise" in warning for warning in report.warnings)


def test_unreadable_file_is_an_error(tmp_path):
    """Classification's error becomes the verdict, with no type checks run."""
    path = tmp_path / "truncated.hdf5"
    make_photoionised_grid(path)
    whole = path.read_bytes()
    path.write_bytes(whole[: len(whole) // 2])

    report = check_file(path)

    assert report.state == "failed"
    assert any("truncated or corrupt" in error for error in report.errors)


def test_report_json_carries_classification_and_verdict(tmp_path):
    """The posted report says what the file is as well as whether it passed."""
    path = tmp_path / "bpass-cloudy-c23.01.hdf5"
    make_photoionised_grid(path)

    payload = check_file(path).to_dict()

    assert payload["data_type"] == "grid"
    assert payload["state"] == "passed"
    assert payload["detected"]["emission_type"] == "photoionised"
    assert payload["reason"]
    assert payload["errors"] == []


def test_main_exit_codes_and_json(tmp_path, capsys):
    """The CLI exits non-zero only when something blocks publication."""
    good = tmp_path / "good-cloudy-c23.01.hdf5"
    make_photoionised_grid(good)
    assert check_module.main([str(good)]) == 0
    assert "ready to submit" in capsys.readouterr().out

    bad = tmp_path / "bad.hdf5"
    make_grid(bad)
    assert check_module.main([str(bad)]) == 1
    assert "not ready" in capsys.readouterr().out

    assert check_module.main([str(good), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["state"] == "passed"
    assert payload["data_type"] == "grid"
    assert payload["filename"] == good.name


def test_main_classify_only_skips_the_checks(tmp_path, capsys):
    """Asking what a file is does not fail on what is wrong with it."""
    bad = tmp_path / "bad.hdf5"
    make_grid(bad)

    assert check_module.main([str(bad), "--classify-only"]) == 0
    output = capsys.readouterr().out
    assert "category" in output
    assert "ERROR" not in output
    # This file would fail the checks, so saying it is ready would be a lie.
    assert "ready to submit" not in output
    assert "not checked" in output


def test_classification_is_reusable_without_rereading(tmp_path):
    """One read of the file serves both steps."""
    path = tmp_path / "bpass-cloudy-c23.01.hdf5"
    make_photoionised_grid(path)

    classification = classify(path)
    assert check(classification).state == "passed"
    # Checking twice off one classification is the same verdict, which is what
    # lets the portal store a classification and re-judge it later.
    assert check(classification).state == "passed"


def test_classify_only_json_omits_the_verdict(tmp_path, capsys):
    """Asking what a file is must not report a pass no rules produced."""
    bad = tmp_path / "bad.hdf5"
    make_grid(bad)

    assert check_module.main([str(bad), "--classify-only", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)

    assert payload["data_type"] == "grid"
    assert "state" not in payload
    assert "errors" not in payload
