"""Tests for marking datasets and releases as deprecated.

The statements are run against a real database with every migration applied,
because what matters is which rows they touch: a release id belonging to a
different dataset must touch none.
"""

import pytest

from samples import migrated_database
from syndex import deprecate


@pytest.fixture
def database():
    """Two datasets with one release each."""
    db = migrated_database()
    one, two = "a" * 64, "b" * 64
    db.executescript(
        f"""
        INSERT INTO files (file_id, filename, r2_path, format, size_bytes, sha256)
        VALUES (1, 'a.hdf5', 'a', 'hdf5', 1, '{one}'),
               (2, 'b.hdf5', 'b', 'hdf5', 1, '{two}');
        INSERT INTO datasets (dataset_id, name, display_name, data_type)
        VALUES (1, 'one', 'One', 'grid'), (2, 'two', 'Two', 'grid');
        INSERT INTO releases (release_id, dataset_id, file_id, published_at)
        VALUES (10, 1, 1, '2026-01-01'), (20, 2, 2, '2026-01-01');
        """
    )
    return db


def test_a_dataset_is_deprecated_and_restored(database):
    sql, params = deprecate.statement("one", None, "Withdrawn.", "2026-11-19")
    assert database.execute(sql, params).fetchall() == [("one",)]
    assert database.execute(
        "SELECT name, deprecated_at, deprecation_reason FROM datasets ORDER BY name"
    ).fetchall() == [("one", "2026-11-19", "Withdrawn."), ("two", None, None)]
    # The releases are left alone: the dataset is what was retired.
    assert database.execute(
        "SELECT COUNT(*) FROM releases WHERE deprecated_at IS NOT NULL"
    ).fetchone() == (0,)

    sql, params = deprecate.statement("one", None, None, None)
    database.execute(sql, params)
    assert database.execute(
        "SELECT deprecated_at, deprecation_reason FROM datasets WHERE name = 'one'"
    ).fetchone() == (None, None)


def test_a_release_is_deprecated_only_under_its_own_dataset(database):
    sql, params = deprecate.statement("one", 20, "Wrong units.", "2026-11-19")
    assert database.execute(sql, params).fetchall() == []
    assert database.execute(
        "SELECT COUNT(*) FROM releases WHERE deprecated_at IS NOT NULL"
    ).fetchone() == (0,)

    sql, params = deprecate.statement("two", 20, "Wrong units.", "2026-11-19")
    assert database.execute(sql, params).fetchall() == [(20,)]
    assert database.execute(
        "SELECT deprecated_at, deprecation_reason FROM releases WHERE release_id = 20"
    ).fetchone() == ("2026-11-19", "Wrong units.")


def test_nothing_matching_is_a_failure(monkeypatch, capsys):
    monkeypatch.setenv("SYNTHESIZER_D1_API_TOKEN", "token")
    monkeypatch.setattr(deprecate, "d1_query", lambda *args: [])
    assert deprecate.run(["missing", "--reason", "Gone."]) == 1
    assert "no such thing as missing" in capsys.readouterr().err


def test_a_reason_is_required(monkeypatch):
    monkeypatch.setenv("SYNTHESIZER_D1_API_TOKEN", "token")
    with pytest.raises(SystemExit):
        deprecate.run(["one"])
    assert deprecate.run(["one", "--reason", "  "]) == 2


def test_a_bad_network_is_an_error_not_a_traceback(monkeypatch, capsys):
    from syndex.previews import store

    def unreachable(request, timeout=None):
        raise store.urllib.error.URLError("no route to host")

    monkeypatch.setenv("SYNTHESIZER_D1_API_TOKEN", "token")
    monkeypatch.setattr(store.urllib.request, "urlopen", unreachable)
    assert deprecate.run(["one", "--reason", "Gone."]) == 1
    assert "could not be reached" in capsys.readouterr().err
