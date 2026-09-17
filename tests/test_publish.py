"""Tests for deciding what to publish and recording that it was.

A plan is built from files and metadata, turned into D1 statements, and
those statements are run against a database with every migration applied --
so a plan that disagrees with the schema fails here rather than in
production. Citations are part of it: they are the reason a file is
published with anything more than a name.
"""

import io
import json
import sqlite3

import h5py
import numpy as np
import pytest

from samples import (
    make_agn_grid,
    make_dust_extinction_grid,
    make_grid,
    make_photometric_imager,
    make_photometric_imager_full,
    make_spectroscopic_full,
    make_sps_grid,
    migrated_database,
)
from syndex.errors import UploadError
from syndex.publish import cli, registry
from syndex.publish.citations import parse_bibtex_entries
from syndex.publish.cli import run
from syndex.publish.plan import build_plan, build_plans
from syndex.publish.registry import d1_statements, publish_all, register_d1
from syndex.publish.sources import SourceFile, discover_files


def test_mixed_directory_detection_and_metadata(tmp_path):
    grid_path = tmp_path / "grid.hdf5"
    make_grid(grid_path)
    data_path = tmp_path / "sample.dat"
    data_path.write_text("sample")
    metadata = {
        "defaults": {"is_test": True},
        "files": {
            "grid.hdf5": {"grid": {"grid_type": "sps", "emission_type": "incident"}},
            "sample.dat": {"data_type": "simulation_data"},
        },
    }
    sources = discover_files([tmp_path])
    plans, errors = build_plans(sources, metadata, {})

    assert not errors
    assert [plan["file"]["format"] for plan in plans] == ["hdf5", "dat"]
    assert [plan["dataset"]["data_type"] for plan in plans] == [
        "grid",
        "simulation_data",
    ]
    assert all(plan["dataset"]["is_test"] for plan in plans)


def test_metadata_precedence(tmp_path):
    path = tmp_path / "sample.dat"
    path.write_text("sample")
    source = SourceFile(path, path.name)

    plan = build_plan(
        source,
        {"data_type": "generation_data", "is_test": False},
        {"data_type": "simulation_data", "is_test": True, "name": "sample-data"},
    )

    assert plan["dataset"]["data_type"] == "simulation_data"
    assert plan["dataset"]["is_test"] is True
    assert plan["dataset"]["name"] == "sample-data"


def test_dry_run_never_creates_cloud_client(tmp_path, monkeypatch, capsys):
    path = tmp_path / "sample.dat"
    path.write_text("sample")
    monkeypatch.setattr(
        cli,
        "s3_client",
        lambda account: (_ for _ in ()).throw(AssertionError()),
    )

    status = run([str(path), "--data-type", "simulation_data", "--dry-run"])

    assert status == 0
    assert (
        json.loads(capsys.readouterr().out)[0]["dataset"]["data_type"]
        == "simulation_data"
    )


def test_prevalidation_failure_aborts_before_cloud(tmp_path, monkeypatch):
    path = tmp_path / "sample.dat"
    path.write_text("sample")
    monkeypatch.setattr(
        cli,
        "s3_client",
        lambda account: (_ for _ in ()).throw(AssertionError()),
    )

    assert run([str(path)]) == 2


def test_sps_incident_grid_classified_from_its_model_group(tmp_path):
    path = tmp_path / "maraston13_kroupa.hdf5"
    make_sps_grid(path)

    plan = build_plan(SourceFile(path, path.name), {}, {})

    # Nothing was supplied by hand: the file says what it is.
    assert plan["dataset"]["data_type"] == "grid"
    assert plan["grid"]["grid_type"] == "sps"
    assert plan["grid"]["emission_type"] == "incident"
    assert plan["grid"]["model_name"] == "maraston13"
    assert plan["grid"]["model_version"] == "2013"
    assert plan["grid"].get("photoionisation_code") is None


def test_photoionised_grid_detected_from_cloudy_parameters(tmp_path):
    path = tmp_path / "maraston13_kroupa_cloudy.hdf5"
    make_sps_grid(path, photoionised=True)

    plan = build_plan(SourceFile(path, path.name), {}, {})

    assert plan["grid"]["emission_type"] == "photoionised"
    assert plan["grid"]["photoionisation_code"] == "Cloudy"
    assert plan["grid"]["photoionisation_code_version"] == "c23.01"


def test_content_flags_match_what_a_grid_holds(tmp_path):
    """has_spectra and has_lines summarise the grid's contents for filtering."""
    spectra_only = tmp_path / "spectra.hdf5"
    make_sps_grid(spectra_only)
    ionising_only = tmp_path / "ionising.hdf5"
    with h5py.File(ionising_only, "w") as hdf:
        hdf.attrs["axes"] = ["ages"]
        hdf.create_group("axes").create_dataset("ages", data=[1e6, 1e7])
        hdf.create_group("log10_specific_ionising_luminosity").create_dataset(
            "HI", data=[1.0, 2.0]
        )
        hdf.create_group("Model").attrs["sps_name"] = "maraston13"
        # Real ionising-only grids come out of a Cloudy run, which is what
        # makes their emission type knowable despite having no spectra.
        hdf.create_group("CloudyParams").attrs["cloudy_version"] = "c23.01"

    database = migrated_database()
    for path, expected in ((spectra_only, (1, 0)), (ionising_only, (0, 0))):
        plan = build_plan(SourceFile(path, path.name), {}, {})
        with database:
            for statement in d1_statements(plan):
                database.execute(statement["sql"], statement["params"])
        row = database.execute(
            "SELECT has_spectra, has_lines FROM grid_metadata g"
            " JOIN releases r ON r.release_id = g.release_id"
            " JOIN files f ON f.file_id = r.file_id WHERE f.sha256 = ?",
            (plan["file"]["sha256"],),
        ).fetchone()
        assert row == expected, path.name


def test_a_lines_only_grid_is_recognised(tmp_path):
    """Grids carrying line luminosities but no spectra are a normal product."""
    path = tmp_path / "qsosed_lines_only.hdf5"
    with h5py.File(path, "w") as hdf:
        hdf.attrs["axes"] = ["masses"]
        axes = hdf.create_group("axes")
        axes.create_dataset("masses", data=[1e8, 1e9])
        lines = hdf.create_group("lines")
        lines.create_dataset("id", data=[b"H 1 1215.67A", b"O 3 5006.84A"])
        wavelength = lines.create_dataset("wavelength", data=[1215.67, 5006.84])
        wavelength.attrs["Units"] = "angstrom"
        lines.create_dataset("luminosity", data=np.ones((2, 2)))
        model = hdf.create_group("Model")
        model.attrs["type"] = "agn"
        model.attrs["family"] = "qsosed"
        hdf.create_group("CloudyParams").attrs["cloudy_version"] = "c23.01"

    plan = build_plan(SourceFile(path, path.name), {}, {})

    assert plan["dataset"]["data_type"] == "grid"
    assert plan["grid"]["available_spectra"] == []
    assert len(plan["grid"]["available_lines"]) == 2
    # Coverage falls back to the line wavelengths when there are no spectra.
    assert plan["grid"]["wavelength"]["minimum"] == 1215.67
    assert plan["grid"]["wavelength"]["units"] == "angstrom"


def test_an_ionising_luminosity_only_grid_is_recognised(tmp_path):
    """Some grids hold only ionising luminosities over their axes."""
    path = tmp_path / "qsosed_ionising_only.hdf5"
    with h5py.File(path, "w") as hdf:
        hdf.attrs["axes"] = ["masses"]
        axes = hdf.create_group("axes")
        axes.create_dataset("masses", data=[1e8, 1e9])
        ionising = hdf.create_group("log10_specific_ionising_luminosity")
        ionising.create_dataset("HI", data=[1.0, 2.0])
        model = hdf.create_group("Model")
        model.attrs["type"] = "agn"
        model.attrs["family"] = "qsosed"
        hdf.create_group("CloudyParams").attrs["cloudy_version"] = "c23.01"

    plan = build_plan(SourceFile(path, path.name), {}, {})

    assert plan["dataset"]["data_type"] == "grid"
    assert plan["grid"]["grid_type"] == "agn"
    assert plan["grid"]["available_spectra"] == []
    assert plan["grid"]["available_lines"] == []
    assert plan["grid"]["wavelength"] == {}


def test_nebular_spectra_mean_reprocessed_even_without_cloudy(tmp_path):
    """Not every model reprocesses through Cloudy."""
    path = tmp_path / "yggdrasil_popiii.hdf5"
    with h5py.File(path, "w") as hdf:
        hdf.attrs["axes"] = ["ages"]
        axes = hdf.create_group("axes")
        axes.create_dataset("ages", data=[1e6, 1e7])
        spectra = hdf.create_group("spectra")
        wavelength = spectra.create_dataset("wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["Units"] = "angstrom"
        # Yggdrasil applies its own nebular treatment and writes no
        # photoionisation parameters at all.
        spectra.create_dataset("nebular_fcov_0.5", data=np.ones((2, 2)))
        model = hdf.create_group("Model")
        model.attrs["sps_name"] = "yggdrasil"

    plan = build_plan(SourceFile(path, path.name), {}, {})

    assert plan["grid"]["emission_type"] == "photoionised"
    assert plan["grid"].get("photoionisation_code") is None


def test_agn_grid_classified_from_its_model_group(tmp_path):
    path = tmp_path / "qsosed.hdf5"
    make_agn_grid(path)

    plan = build_plan(SourceFile(path, path.name), {}, {})

    assert plan["grid"]["grid_type"] == "agn"
    assert plan["grid"]["emission_type"] == "photoionised"
    assert plan["grid"]["model_name"] == "qsosed"


def test_explicit_metadata_still_overrides_detection(tmp_path):
    path = tmp_path / "maraston13_kroupa.hdf5"
    make_sps_grid(path)

    plan = build_plan(
        SourceFile(path, path.name),
        {},
        {"grid": {"model_name": "Maraston (2013)", "emission_type": "incident"}},
    )

    # Curated names win over the raw value written by the generator.
    assert plan["grid"]["model_name"] == "Maraston (2013)"
    assert plan["grid"]["grid_type"] == "sps"


def test_dust_extinction_curve_grid_type_detected(tmp_path):
    path = tmp_path / "dust.hdf5"
    make_dust_extinction_grid(path)
    source = SourceFile(path, path.name)

    plan = build_plan(source, {}, {})

    assert plan["grid"]["grid_type"] == "dust"
    assert plan["grid"]["emission_type"] == "dust_attenuation"


def test_dust_grids_are_a_separate_data_type_and_prefix(tmp_path):
    dust_path = tmp_path / "dust.hdf5"
    make_dust_extinction_grid(dust_path)
    stellar_path = tmp_path / "grid.hdf5"
    make_grid(stellar_path)
    metadata = {
        "defaults": {},
        "files": {
            "grid.hdf5": {"grid": {"grid_type": "sps", "emission_type": "incident"}}
        },
    }
    sources = discover_files([tmp_path])

    plans, errors = build_plans(sources, metadata, {})

    assert not errors
    by_name = {plan["file"]["filename"]: plan for plan in plans}
    dust = by_name["dust.hdf5"]
    stellar = by_name["grid.hdf5"]
    assert dust["dataset"]["data_type"] == "dust_grid"
    assert dust["file"]["r2_path"].startswith("dust-grid/")
    assert dust["grid"]["axes"], "dust grids still populate grid_axes"
    assert stellar["dataset"]["data_type"] == "grid"
    assert stellar["file"]["r2_path"].startswith("grid/")


def test_test_dust_grid_prefix_stays_under_test_data(tmp_path):
    path = tmp_path / "dust.hdf5"
    make_dust_extinction_grid(path)
    source = SourceFile(path, path.name)

    plan = build_plan(source, {"is_test": True}, {})

    assert plan["file"]["r2_path"].startswith("test-data/dust-grid/")


def test_build_plan_instrument(tmp_path):
    path = tmp_path / "instrument.hdf5"
    make_photometric_imager(path)
    source = SourceFile(path, path.name)

    plan = build_plan(source, {"data_type": "instrument"}, {})

    assert plan["instrument"]["instrument_type"] == "photometric_imager"
    assert plan["grid"] is None


def test_unsafe_prefix_rejected(tmp_path):
    path = tmp_path / "sample.dat"
    path.write_text("sample")

    try:
        build_plan(
            SourceFile(path, path.name),
            {"data_type": "simulation_data", "r2_prefix": "../unsafe"},
            {},
        )
    except UploadError as exc:
        assert "Unsafe R2 prefix" in str(exc)
    else:
        raise AssertionError("unsafe prefix was accepted")


def test_batch_continues_after_publish_error():
    plans = [{"source_path": name} for name in ("a", "b", "c")]
    visited = []

    def publish(plan):
        visited.append(plan["source_path"])
        if plan["source_path"] == "b":
            raise RuntimeError("failed")

    failures = publish_all(plans, publish)

    assert visited == ["a", "b", "c"]
    assert failures == [("b", "failed")]


def test_d1_batch_is_parameterized(tmp_path):
    path = tmp_path / "dangerous-name.dat"
    path.write_text("sample")
    plan = build_plan(
        SourceFile(path, path.name),
        {
            "data_type": "simulation_data",
            "display_name": "Robert'); DROP TABLE files;--",
        },
        {},
    )

    statements = d1_statements(plan)

    assert "DROP TABLE" not in " ".join(item["sql"] for item in statements)
    assert any("DROP TABLE" in str(item["params"]) for item in statements)
    assert "ELSE NULL" in statements[2]["sql"]


def test_d1_registration_sends_one_batch(tmp_path, monkeypatch):
    path = tmp_path / "sample.dat"
    path.write_text("sample")
    plan = build_plan(SourceFile(path, path.name), {"data_type": "simulation_data"}, {})
    captured = {}

    def urlopen(request, timeout):
        captured["body"] = json.loads(request.data)
        captured["authorization"] = request.headers["Authorization"]
        return io.BytesIO(b'{"success":true,"result":[{"success":true}]}')

    monkeypatch.setattr(registry.urllib.request, "urlopen", urlopen)

    register_d1("account", "database", "secret-token", plan)

    assert captured["body"] == {"batch": d1_statements(plan)}
    assert captured["authorization"] == "Bearer secret-token"


def test_d1_batch_matches_migration_and_is_idempotent(tmp_path):
    path = tmp_path / "grid.hdf5"
    make_grid(path)
    plan = build_plan(
        SourceFile(path, path.name),
        {
            "is_test": True,
            "set_current": True,
            "grid": {"grid_type": "sps", "emission_type": "incident"},
        },
        {},
    )
    database = migrated_database()

    for _ in range(2):
        with database:
            for statement in d1_statements(plan):
                database.execute(statement["sql"], statement["params"])

    assert database.execute("SELECT count(*) FROM files").fetchone() == (1,)
    assert database.execute("SELECT count(*) FROM datasets").fetchone() == (1,)
    assert database.execute("SELECT count(*) FROM releases").fetchone() == (1,)
    assert database.execute("SELECT count(*) FROM grid_axes").fetchone() == (2,)
    assert database.execute(
        "SELECT current_release_id IS NOT NULL FROM datasets"
    ).fetchone() == (1,)


def test_instrument_d1_batch_matches_migration(tmp_path):
    path = tmp_path / "instrument.hdf5"
    make_photometric_imager_full(path)
    plan = build_plan(
        SourceFile(path, path.name),
        {"data_type": "instrument", "is_test": True, "set_current": True},
        {},
    )
    database = migrated_database()

    for _ in range(2):
        with database:
            for statement in d1_statements(plan):
                database.execute(statement["sql"], statement["params"])

    row = database.execute(
        "SELECT instrument_type, label, psf_resample_factor, depth_json, "
        "psfs_json, resolving_power FROM instruments"
    ).fetchone()
    assert row[0] == "photometric_imager"
    assert row[1] == "TestImagerFull"
    assert row[2] == 2
    assert json.loads(row[3])["kind"] == "per_key"
    assert json.loads(row[4])["kind"] == "per_key"
    assert row[5] is None


def test_spectroscopic_resolving_power_d1_batch_matches_migration(tmp_path):
    path = tmp_path / "instrument.hdf5"
    make_spectroscopic_full(path)
    plan = build_plan(
        SourceFile(path, path.name),
        {"data_type": "instrument", "is_test": True, "set_current": True},
        {},
    )
    database = migrated_database()

    for statement in d1_statements(plan):
        database.execute(statement["sql"], statement["params"])

    row = database.execute(
        "SELECT instrument_type, resolving_power FROM instruments"
    ).fetchone()
    assert row == ("spectroscopic", 1000.0)


def test_same_file_cannot_move_between_datasets(tmp_path):
    path = tmp_path / "sample.dat"
    path.write_text("sample")
    source = SourceFile(path, path.name)
    first = build_plan(source, {"data_type": "simulation_data"}, {})
    second = build_plan(
        source,
        {"data_type": "simulation_data", "name": "different-dataset"},
        {},
    )
    database = migrated_database()
    with database:
        for statement in d1_statements(first):
            database.execute(statement["sql"], statement["params"])

    with pytest.raises(sqlite3.IntegrityError), database:
        for statement in d1_statements(second):
            database.execute(statement["sql"], statement["params"])


CITATION = {
    "bibcode": "2003MNRAS.344.1000B",
    "bibtex": "@ARTICLE{2003MNRAS.344.1000B,\n  title = {Stellar population synthesis}\n}",
    "doi": "10.1046/j.1365-8711.2003.06897.x",
    "authors": "Bruzual, G. and Charlot, S.",
    "title": "Stellar population synthesis at the resolution of 2003",
    "year": 2003,
    "journal": "MNRAS",
}
RELEASE_PAPER = {
    "bibcode": "2026arXiv260727467V",
    "bibtex": "@ARTICLE{2026arXiv260727467V,\n  title = {Stellar photoionisation}\n}",
    "doi": None,
    "authors": "Vijayan, A. P.",
    "title": "Stellar photoionisation modelling in SYNTHESIZER",
    "year": 2026,
    "journal": "arXiv e-prints",
}


def _publish(database, plan):
    with database:
        for statement in d1_statements(plan):
            database.execute(statement["sql"], statement["params"])


def _plan_with_citations(tmp_path, name, citations):
    path = tmp_path / f"{name}.dat"
    path.write_text(name)
    plan = build_plan(
        SourceFile(path, path.name),
        {"data_type": "simulation_data", "name": name},
        {},
    )
    plan["citations"] = citations
    return plan


def test_a_paper_cited_by_two_files_is_stored_once(tmp_path):
    """The release paper is shared by every grid; it must not be duplicated."""
    database = migrated_database()
    _publish(database, _plan_with_citations(tmp_path, "one", [CITATION, RELEASE_PAPER]))
    _publish(database, _plan_with_citations(tmp_path, "two", [RELEASE_PAPER]))

    (citations,) = database.execute("SELECT COUNT(*) FROM citations").fetchone()
    (links,) = database.execute("SELECT COUNT(*) FROM file_citations").fetchone()
    assert citations == 2, "two distinct papers"
    assert links == 3, "three file-to-paper links"

    shared = database.execute(
        "SELECT COUNT(*) FROM file_citations fc JOIN citations c "
        "ON c.citation_id = fc.citation_id WHERE c.bibcode = ?",
        (RELEASE_PAPER["bibcode"],),
    ).fetchone()[0]
    assert shared == 2, "one row, cited by both files"


def test_citation_order_is_preserved(tmp_path):
    """Position records the conventional citation order."""
    database = migrated_database()
    _publish(
        database, _plan_with_citations(tmp_path, "ordered", [CITATION, RELEASE_PAPER])
    )

    rows = database.execute(
        "SELECT c.bibcode FROM file_citations fc JOIN citations c "
        "ON c.citation_id = fc.citation_id ORDER BY fc.position"
    ).fetchall()
    assert [row[0] for row in rows] == [CITATION["bibcode"], RELEASE_PAPER["bibcode"]]


def test_republishing_refreshes_citation_metadata(tmp_path):
    """A corrected record from ADS should update the stored one, not duplicate it."""
    database = migrated_database()
    _publish(database, _plan_with_citations(tmp_path, "refresh", [CITATION]))
    corrected = dict(CITATION, title="A corrected title", year=2004)
    _publish(database, _plan_with_citations(tmp_path, "refresh", [corrected]))

    rows = database.execute("SELECT title, year FROM citations").fetchall()
    assert rows == [("A corrected title", 2004)]


def test_a_file_with_no_citations_writes_nothing(tmp_path):
    database = migrated_database()
    _publish(database, _plan_with_citations(tmp_path, "bare", []))
    assert database.execute("SELECT COUNT(*) FROM citations").fetchone()[0] == 0
    assert database.execute("SELECT COUNT(*) FROM file_citations").fetchone()[0] == 0


def test_bibtex_fields_are_extracted():
    """Enough is parsed to render a citation without a BibTeX parser."""
    entries = parse_bibtex_entries(
        "@ARTICLE{2018MNRAS.480.1247K,\n"
        "       author = {{Kubota}, Aya and {Done}, Chris},\n"
        '        title = "{A physical model of the broad-band continuum}",\n'
        "      journal = {\\mnras},\n"
        "         year = 2018,\n"
        "          doi = {10.1093/mnras/sty1890},\n"
        "}\n"
    )
    (record,) = entries.values()
    assert record["bibcode"] == "2018MNRAS.480.1247K"
    assert record["year"] == 2018
    assert record["journal"] == "MNRAS", "the ADS macro must be readable"
    assert record["doi"] == "10.1093/mnras/sty1890"
    assert "Kubota" in record["authors"]
    assert record["title"].startswith("A physical model")
