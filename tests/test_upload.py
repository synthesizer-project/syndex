import io
import json
import sqlite3
from pathlib import Path

import h5py
import numpy as np
import pytest

from syndicate import upload


def make_grid(path: Path) -> None:
    with h5py.File(path, "w") as hdf:
        hdf.attrs["axes"] = ["age", "metallicity"]
        hdf.attrs["date_created"] = "2026-01-01"
        axes = hdf.create_group("axes")
        age = axes.create_dataset("age", data=[1.0, 10.0])
        age.attrs["Units"] = "yr"
        age.attrs["log_on_read"] = True
        metallicity = axes.create_dataset("metallicity", data=[0.01, 0.02])
        metallicity.attrs["Units"] = "dimensionless"
        spectra = hdf.create_group("spectra")
        wavelength = spectra.create_dataset("wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["Units"] = "angstrom"
        spectra.create_dataset("incident", data=np.ones((2, 2, 2)))
        model = hdf.create_group("Model")
        model.attrs["name"] = "test-model"


def make_dust_extinction_grid(path: Path) -> None:
    with h5py.File(path, "w") as hdf:
        hdf.attrs["axes"] = ["dtg"]
        axes = hdf.create_group("axes")
        dtg = axes.create_dataset("dtg", data=[1e-3, 1e-2])
        dtg.attrs["Units"] = "dimensionless"
        extinction = hdf.create_group("extinction_curves")
        wavelength = extinction.create_dataset("wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["Units"] = "angstrom"
        extinction.create_dataset("silicate", data=np.ones(2))


def make_photometric_imager(path: Path) -> None:
    with h5py.File(path, "w") as hdf:
        hdf.attrs["label"] = "TestImager"
        filters = hdf.create_group("Filters")
        header = filters.create_group("Header")
        header.attrs["filter_codes"] = ["Test/A", "Test/B"]
        header.attrs["Wavelength_units"] = "angstrom"
        header.create_dataset("Wavelengths", data=[1000.0, 2000.0, 3000.0])
        resolution = hdf.create_dataset("Resolution", data=0.1)
        resolution.attrs["units"] = "arcsec"


def make_instrument_collection(path: Path) -> None:
    with h5py.File(path, "w") as hdf:
        hdf.attrs["label"] = "TestCollection"
        for name in ("A", "B"):
            member = hdf.create_group(name)
            member.attrs["label"] = name
            wavelength = member.create_dataset("Wavelength", data=[1000.0, 2000.0])
            wavelength.attrs["units"] = "angstrom"


def make_photometric_imager_full(path: Path) -> None:
    """Build the real generic to_hdf5 layout with Depth/SNRs/PSFs/noise.

    Filter codes deliberately contain "/" (the real Synthesizer convention,
    e.g. "Test/A") so tests exercise h5py's implicit path-splitting nesting.
    """
    with h5py.File(path, "w") as hdf:
        hdf.attrs["label"] = "TestImagerFull"
        hdf.attrs["instrument_type"] = "photometric_imager"
        filters = hdf.create_group("Filters")
        header = filters.create_group("Header")
        header.attrs["filter_codes"] = ["Test/A", "Test/B"]
        header.attrs["Wavelength_units"] = "angstrom"
        header.create_dataset("Wavelengths", data=[1000.0, 2000.0, 3000.0])
        resolution = hdf.create_dataset("Resolution", data=0.1)
        resolution.attrs["units"] = "arcsec"

        depth_group = hdf.create_group("Depth")
        for code, value in (("Test/A", 28.0), ("Test/B", 29.0)):
            ds = depth_group.create_dataset(code, data=value)
            ds.attrs["units"] = "AB_mag"

        snrs = hdf.create_dataset("SNRs", data=10.0)
        snrs.attrs["units"] = "dimensionless"

        psfs_group = hdf.create_group("PSFs")
        for code in ("Test/A", "Test/B"):
            ds = psfs_group.create_dataset(code, data=np.ones((4, 4)))
            ds.attrs["units"] = "dimensionless"

        resample = hdf.create_dataset("PSFResampleFactor", data=2)
        resample.attrs["units"] = "dimensionless"

        noise_group = hdf.create_group("NoiseMaps")
        for code in ("Test/A", "Test/B"):
            ds = noise_group.create_dataset(code, data=np.ones((4, 4)))
            ds.attrs["units"] = "nJy"


def make_spectroscopic_full(path: Path) -> None:
    with h5py.File(path, "w") as hdf:
        hdf.attrs["label"] = "TestSpectrograph"
        hdf.attrs["instrument_type"] = "spectroscopic"
        hdf.attrs["resolving_power"] = 1000.0
        wavelength = hdf.create_dataset("Wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["units"] = "angstrom"
        depth = hdf.create_dataset("Depth", data=25.0)
        depth.attrs["units"] = "AB_mag"
        snrs = hdf.create_dataset("SNRs", data=5.0)
        snrs.attrs["units"] = "dimensionless"


def make_ifu_full(path: Path) -> None:
    with h5py.File(path, "w") as hdf:
        hdf.attrs["label"] = "TestIFU"
        hdf.attrs["instrument_type"] = "ifu"
        hdf.attrs["resolving_power"] = 500.0
        wavelength = hdf.create_dataset("Wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["units"] = "angstrom"
        resolution = hdf.create_dataset("Resolution", data=0.05)
        resolution.attrs["units"] = "arcsec"
        psfs = hdf.create_dataset("PSFs", data=np.ones((4, 4, 2)))
        psfs.attrs["units"] = "dimensionless"


def make_real_collection(path: Path) -> None:
    """Build the real InstrumentCollection.write_instruments layout."""
    with h5py.File(path, "w") as hdf:
        head = hdf.create_group("Header")
        head.attrs["synthesizer_version"] = "0.0.0"
        head.attrs["ninstruments"] = 2

        imager = hdf.create_group("TestImagerFull")
        imager.attrs["label"] = "TestImagerFull"
        imager.attrs["instrument_type"] = "photometric_imager"
        filters = imager.create_group("Filters")
        header = filters.create_group("Header")
        header.attrs["filter_codes"] = ["Test/A"]
        header.attrs["Wavelength_units"] = "angstrom"
        header.create_dataset("Wavelengths", data=[1000.0, 2000.0])
        resolution = imager.create_dataset("Resolution", data=0.1)
        resolution.attrs["units"] = "arcsec"

        spec = hdf.create_group("TestSpectrograph")
        spec.attrs["label"] = "TestSpectrograph"
        spec.attrs["instrument_type"] = "spectroscopic"
        wavelength = spec.create_dataset("Wavelength", data=[1000.0, 2000.0])
        wavelength.attrs["units"] = "angstrom"


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
    sources = upload.discover_files([tmp_path])
    plans, errors = upload.build_plans(sources, metadata, {})

    assert not errors
    assert [plan["file"]["format"] for plan in plans] == ["hdf5", "dat"]
    assert [plan["dataset"]["data_type"] for plan in plans] == [
        "grid",
        "simulation_data",
    ]
    assert all(plan["dataset"]["is_test"] for plan in plans)


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

    assert upload.detect_format(path) == expected


def test_grid_extraction_reads_metadata_not_spectra(tmp_path):
    path = tmp_path / "grid.hdf5"
    make_grid(path)

    result = upload.extract_hdf5(path)

    assert result["available_spectra"] == ["incident"]
    assert result["axes"][0]["values"] == [1.0, 10.0]
    assert result["axes"][0]["scale"] == "log"
    assert "spectra" not in result


def test_metadata_precedence(tmp_path):
    path = tmp_path / "sample.dat"
    path.write_text("sample")
    source = upload.SourceFile(path, path.name)

    plan = upload.build_plan(
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
        upload,
        "_make_s3_client",
        lambda account: (_ for _ in ()).throw(AssertionError()),
    )

    status = upload.run([str(path), "--data-type", "simulation_data", "--dry-run"])

    assert status == 0
    assert (
        json.loads(capsys.readouterr().out)[0]["dataset"]["data_type"]
        == "simulation_data"
    )


def test_prevalidation_failure_aborts_before_cloud(tmp_path, monkeypatch):
    path = tmp_path / "sample.dat"
    path.write_text("sample")
    monkeypatch.setattr(
        upload,
        "_make_s3_client",
        lambda account: (_ for _ in ()).throw(AssertionError()),
    )

    assert upload.run([str(path)]) == 2


def test_dust_extinction_curve_grid_type_detected(tmp_path):
    path = tmp_path / "dust.hdf5"
    make_dust_extinction_grid(path)
    source = upload.SourceFile(path, path.name)

    plan = upload.build_plan(source, {}, {})

    assert plan["grid"]["grid_type"] == "dust"
    assert plan["grid"]["emission_type"] == "dust_attenuation"


def test_photometric_imager_extraction(tmp_path):
    path = tmp_path / "instrument.hdf5"
    make_photometric_imager(path)

    result = upload.extract_instrument_hdf5(path)

    assert result["instrument_type"] == "photometric_imager"
    assert result["filter_codes"] == ["Test/A", "Test/B"]
    assert result["wavelength"]["minimum"] == 1000.0
    assert result["wavelength"]["maximum"] == 3000.0
    assert result["resolution"] == {"value": 0.1, "units": "arcsec"}


def test_photometric_imager_full_extraction(tmp_path):
    path = tmp_path / "instrument.hdf5"
    make_photometric_imager_full(path)

    result = upload.extract_instrument_hdf5(path)

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

    result = upload.extract_instrument_hdf5(path)

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

    result = upload.extract_instrument_hdf5(path)

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

    result = upload.extract_instrument_hdf5(path)

    assert result["instrument_type"] == "collection"
    assert set(result["members"]) == {"TestImagerFull", "TestSpectrograph"}
    assert result["members"]["TestImagerFull"]["instrument_type"] == (
        "photometric_imager"
    )
    assert result["members"]["TestSpectrograph"]["instrument_type"] == ("spectroscopic")


def test_instrument_collection_extraction(tmp_path):
    path = tmp_path / "collection.hdf5"
    make_instrument_collection(path)

    result = upload.extract_instrument_hdf5(path)

    assert result["instrument_type"] == "collection"
    assert set(result["members"]) == {"A", "B"}
    assert result["members"]["A"]["instrument_type"] == "spectroscopic"


def test_build_plan_instrument(tmp_path):
    path = tmp_path / "instrument.hdf5"
    make_photometric_imager(path)
    source = upload.SourceFile(path, path.name)

    plan = upload.build_plan(source, {"data_type": "instrument"}, {})

    assert plan["instrument"]["instrument_type"] == "photometric_imager"
    assert plan["grid"] is None


def test_unsafe_prefix_rejected(tmp_path):
    path = tmp_path / "sample.dat"
    path.write_text("sample")

    try:
        upload.build_plan(
            upload.SourceFile(path, path.name),
            {"data_type": "simulation_data", "r2_prefix": "../unsafe"},
            {},
        )
    except upload.UploadError as exc:
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

    failures = upload.publish_all(plans, publish)

    assert visited == ["a", "b", "c"]
    assert failures == [("b", "failed")]


def test_upload_verifies_r2_metadata(tmp_path):
    path = tmp_path / "sample.dat"
    path.write_text("sample")
    plan = upload.build_plan(
        upload.SourceFile(path, path.name), {"data_type": "simulation_data"}, {}
    )

    class MissingObject(Exception):
        def __init__(self):
            self.response = {
                "Error": {"Code": "404"},
                "ResponseMetadata": {"HTTPStatusCode": 404},
            }

    class FakeS3:
        def __init__(self):
            self.object = None

        def head_object(self, *, Bucket, Key):
            if self.object is None:
                raise MissingObject
            return self.object

        def upload_file(self, filename, bucket, key, ExtraArgs):
            self.object = {
                "ContentLength": Path(filename).stat().st_size,
                "Metadata": ExtraArgs["Metadata"],
            }

    client = FakeS3()
    upload.upload_and_verify(client, "bucket", plan)

    assert client.object["Metadata"]["sha256"] == plan["file"]["sha256"]


def test_d1_batch_is_parameterized(tmp_path):
    path = tmp_path / "dangerous-name.dat"
    path.write_text("sample")
    plan = upload.build_plan(
        upload.SourceFile(path, path.name),
        {
            "data_type": "simulation_data",
            "display_name": "Robert'); DROP TABLE files;--",
        },
        {},
    )

    statements = upload.d1_statements(plan)

    assert "DROP TABLE" not in " ".join(item["sql"] for item in statements)
    assert any("DROP TABLE" in str(item["params"]) for item in statements)
    assert "ELSE NULL" in statements[2]["sql"]


def test_d1_registration_sends_one_batch(tmp_path, monkeypatch):
    path = tmp_path / "sample.dat"
    path.write_text("sample")
    plan = upload.build_plan(
        upload.SourceFile(path, path.name), {"data_type": "simulation_data"}, {}
    )
    captured = {}

    def urlopen(request, timeout):
        captured["body"] = json.loads(request.data)
        captured["authorization"] = request.headers["Authorization"]
        return io.BytesIO(b'{"success":true,"result":[{"success":true}]}')

    monkeypatch.setattr(upload.urllib.request, "urlopen", urlopen)

    upload.register_d1("account", "database", "secret-token", plan)

    assert captured["body"] == {"batch": upload.d1_statements(plan)}
    assert captured["authorization"] == "Bearer secret-token"


def test_d1_batch_matches_migration_and_is_idempotent(tmp_path):
    path = tmp_path / "grid.hdf5"
    make_grid(path)
    plan = upload.build_plan(
        upload.SourceFile(path, path.name),
        {
            "is_test": True,
            "set_current": True,
            "grid": {"grid_type": "sps", "emission_type": "incident"},
        },
        {},
    )
    migration = Path(__file__).parents[1] / "migrations/0001_initial.sql"
    database = sqlite3.connect(":memory:")
    database.executescript(migration.read_text())

    for _ in range(2):
        with database:
            for statement in upload.d1_statements(plan):
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
    plan = upload.build_plan(
        upload.SourceFile(path, path.name),
        {"data_type": "instrument", "is_test": True, "set_current": True},
        {},
    )
    migration = Path(__file__).parents[1] / "migrations/0001_initial.sql"
    database = sqlite3.connect(":memory:")
    database.executescript(migration.read_text())

    for _ in range(2):
        with database:
            for statement in upload.d1_statements(plan):
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
    plan = upload.build_plan(
        upload.SourceFile(path, path.name),
        {"data_type": "instrument", "is_test": True, "set_current": True},
        {},
    )
    migration = Path(__file__).parents[1] / "migrations/0001_initial.sql"
    database = sqlite3.connect(":memory:")
    database.executescript(migration.read_text())

    for statement in upload.d1_statements(plan):
        database.execute(statement["sql"], statement["params"])

    row = database.execute(
        "SELECT instrument_type, resolving_power FROM instruments"
    ).fetchone()
    assert row == ("spectroscopic", 1000.0)


def test_same_file_cannot_move_between_datasets(tmp_path):
    path = tmp_path / "sample.dat"
    path.write_text("sample")
    source = upload.SourceFile(path, path.name)
    first = upload.build_plan(source, {"data_type": "simulation_data"}, {})
    second = upload.build_plan(
        source,
        {"data_type": "simulation_data", "name": "different-dataset"},
        {},
    )
    migration = Path(__file__).parents[1] / "migrations/0001_initial.sql"
    database = sqlite3.connect(":memory:")
    database.executescript(migration.read_text())
    with database:
        for statement in upload.d1_statements(first):
            database.execute(statement["sql"], statement["params"])

    with pytest.raises(sqlite3.IntegrityError), database:
        for statement in upload.d1_statements(second):
            database.execute(statement["sql"], statement["params"])
