"""Tests for the command-line submission client.

Nothing here talks to GitHub or to the portal: what is worth pinning is that
the pieces are the size the Worker expects, that a refusal is reported rather
than retried forever, and that the session is not left world-readable on a
shared machine.
"""

import json
import math

import pytest

from syndex import submit


def _worker_constant(name):
    """Read one exported constant out of the Worker's submissions module.

    Args:
        name (str): The exported name.

    Returns:
        int: Its value.
    """
    source = (
        submit.Path(__file__).parents[1] / "src/portal/data/submissions.js"
    ).read_text()
    expression = source.split(f"export const {name} = ")[1].split(";")[0]

    # Multiplied literals, which is all these are: "90 * 1024 * 1024", "2000".
    # Parsed rather than evaluated -- `eval` on a file's contents is a habit
    # worth not having, and it would accept a great deal more than this needs
    # to.
    factors = [part.strip() for part in expression.split("*")]
    assert all(part.isdigit() for part in factors), expression
    return math.prod(int(part) for part in factors)


@pytest.mark.parametrize("name", ["PART_SIZE", "MAX_PARTS"])
def test_limits_match_the_worker(name):
    """The client and the Worker have to agree, and nothing makes them.

    Both numbers live in two files because the browser and this client send to
    the same endpoint, and neither is a setting anybody can pass. A PART_SIZE
    mismatch is the worse one -- R2 refuses a multipart upload whose parts are
    not all one size, and it does not say so until completion, after the whole
    file has gone up -- but a stale MAX_PARTS means refusing a file the service
    would have taken, or promising one it will not.
    """
    assert _worker_constant(name) == getattr(submit, name)


def test_a_refusal_is_reported_not_retried(tmp_path, monkeypatch):
    """A 4xx is the portal's final answer, and retrying only delays saying so."""
    path = tmp_path / "grid.hdf5"
    path.write_bytes(b"0123456789")

    attempts = []

    def refuse(url, payload=None, **kwargs):
        attempts.append(url)
        return 409, {"error": "This submission already has its file"}

    monkeypatch.setattr(submit, "_json_request", refuse)

    with pytest.raises(submit.SubmitError, match="already has its file"):
        submit.send("https://example.org/syndex", "t", "tok", path, quiet=True)

    assert len(attempts) == 1


def test_a_server_fault_is_retried(tmp_path, monkeypatch):
    """A 5xx or a dropped connection might work on the next try."""
    path = tmp_path / "grid.hdf5"
    path.write_bytes(b"0123456789")

    attempts = []

    def flaky(url, payload=None, **kwargs):
        attempts.append(url)
        if "part" in url and len(attempts) < 3:
            return 503, {}
        return 200, {}

    monkeypatch.setattr(submit, "_json_request", flaky)
    monkeypatch.setattr(submit.time, "sleep", lambda _: None)

    submit.send("https://example.org/syndex", "t", "tok", path, quiet=True)

    # Two failures, then the part, then the completion.
    assert len([one for one in attempts if "part" in one]) == 3


def test_the_declared_size_is_what_was_read(tmp_path, monkeypatch):
    """The portal compares this against what it assembled, so it must be real."""
    path = tmp_path / "grid.hdf5"
    path.write_bytes(b"x" * 4096)

    sent = {}

    def record(url, payload=None, **kwargs):
        if url.endswith("/complete"):
            sent["body"] = kwargs["data"]
        return 200, {}

    monkeypatch.setattr(submit, "_json_request", record)
    submit.send("https://example.org/syndex", "t", "tok", path, quiet=True)

    assert sent["body"] == b"expected_size=4096"


def test_a_stored_session_is_not_world_readable(tmp_path, monkeypatch):
    """An HPC login node is a shared machine, and this is a bearer token."""
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))

    submit._store_token("a-session-token")
    path = submit._config_path()

    assert json.loads(path.read_text())["token"] == "a-session-token"
    assert path.stat().st_mode & 0o077 == 0
    assert submit._stored_token() == "a-session-token"


def test_a_missing_session_is_not_an_error(tmp_path, monkeypatch):
    """Nothing stored means sign in, not fail."""
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    assert submit._stored_token() is None


def test_check_stops_a_file_that_would_be_rejected(tmp_path, capsys, monkeypatch):
    """--check is the same checker, run before 30 GB goes anywhere."""
    from samples import make_grid

    path = tmp_path / "mystery.hdf5"
    make_grid(path)

    def fail(*args, **kwargs):
        raise AssertionError("nothing should be sent")

    monkeypatch.setattr(submit, "send", fail)

    assert submit.main([str(path.name), str(path), "--check"]) == 1
    assert "would not be published" in capsys.readouterr().err
