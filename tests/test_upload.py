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
