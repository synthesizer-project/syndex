"""Tests for getting the bytes into R2 without losing any of them.

Everything here is about the failures that matter: a part that fails once, a
part that never succeeds, an upload picked up after an interruption, and an
object that arrives shorter than it left. None of it talks to R2 -- the
client is a double that fails on demand -- because what is being tested is
what this code does about a failure, not that boto3 works.
"""

from pathlib import Path

import pytest
from samples import make_grid

from syndex.publish import storage
from syndex.publish.plan import build_plan
from syndex.publish.sources import SourceFile
from syndex.publish.storage import PART_SIZE_BYTES, _upload_resumable, upload_and_verify


def test_upload_verifies_r2_metadata(tmp_path):
    path = tmp_path / "sample.dat"
    path.write_text("sample")
    plan = build_plan(SourceFile(path, path.name), {"data_type": "simulation_data"}, {})

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

        def upload_file(self, filename, bucket, key, ExtraArgs, **kwargs):
            self.object = {
                "ContentLength": Path(filename).stat().st_size,
                "Metadata": ExtraArgs["Metadata"],
            }

    client = FakeS3()
    upload_and_verify(client, "bucket", plan)

    assert client.object["Metadata"]["sha256"] == plan["file"]["sha256"]


def test_a_failed_transfer_is_retried(tmp_path):
    """A dropped connection costs a retry, not the whole transfer."""
    path = tmp_path / "grid.hdf5"
    make_grid(path)
    plan = build_plan(
        SourceFile(path, path.name),
        {"grid": {"grid_type": "sps", "emission_type": "incident"}},
        {},
    )
    attempts = []

    class FlakyClient:
        def head_object(self, **kwargs):
            if not attempts:
                error = Exception("missing")
                error.response = {"Error": {"Code": "404"}}
                raise error
            return {
                "ContentLength": plan["file"]["size_bytes"],
                "Metadata": {"sha256": plan["file"]["sha256"]},
            }

        def upload_file(self, *args, **kwargs):
            attempts.append(1)
            if len(attempts) < 2:
                raise OSError("SSL validation failed")

    upload_and_verify(FlakyClient(), "bucket", plan)

    assert len(attempts) == 2, "the transfer should have been retried once"


def test_a_transfer_that_keeps_failing_gives_up(tmp_path):
    """Retries are bounded, so a genuinely broken transfer still reports."""
    path = tmp_path / "grid.hdf5"
    make_grid(path)
    plan = build_plan(
        SourceFile(path, path.name),
        {"grid": {"grid_type": "sps", "emission_type": "incident"}},
        {},
    )

    class BrokenClient:
        def head_object(self, **kwargs):
            error = Exception("missing")
            error.response = {"Error": {"Code": "404"}}
            raise error

        def upload_file(self, *args, **kwargs):
            raise OSError("SSL validation failed")

    with pytest.raises(OSError, match="SSL validation failed"):
        upload_and_verify(BrokenClient(), "bucket", plan)


class FlakyMultipartClient:
    """A stub R2 client that fails a chosen part a set number of times.

    Records every part upload attempt so a test can prove that a failure costs
    one part rather than the whole transfer.
    """

    def __init__(self, fail_part=None, failures=0, existing_parts=()):
        self.fail_part = fail_part
        self.remaining_failures = failures
        self.attempts = []
        self.completed = None
        self.created = 0
        self._existing = {n: f'"etag{n}"' for n in existing_parts}

    def list_multipart_uploads(self, **kwargs):
        if not self._existing:
            return {}
        return {"Uploads": [{"Key": kwargs["Prefix"], "UploadId": "resumed"}]}

    def list_parts(self, **kwargs):
        return {
            "Parts": [
                {"PartNumber": n, "ETag": tag} for n, tag in self._existing.items()
            ],
            "IsTruncated": False,
        }

    def create_multipart_upload(self, **kwargs):
        self.created += 1
        return {"UploadId": "fresh"}

    def upload_part(self, **kwargs):
        number = kwargs["PartNumber"]
        self.attempts.append(number)
        if number == self.fail_part and self.remaining_failures > 0:
            self.remaining_failures -= 1
            raise RuntimeError("SSL validation failed (_ssl.c:2406)")
        return {"ETag": f'"etag{number}"'}

    def complete_multipart_upload(self, **kwargs):
        self.completed = kwargs["MultipartUpload"]["Parts"]


def _big_plan(tmp_path, parts):
    """A plan whose file spans the given number of whole parts."""
    size = PART_SIZE_BYTES * parts
    path = tmp_path / "big.hdf5"
    with open(path, "wb") as handle:
        handle.truncate(size)
    return {
        "source_path": str(path),
        "file": {"filename": "big.hdf5", "size_bytes": size},
    }


def test_a_failing_part_is_retried_alone(tmp_path, monkeypatch):
    """The point of the manual path: one bad part must not restart the file."""
    monkeypatch.setattr(storage.time, "sleep", lambda _: None)
    client = FlakyMultipartClient(fail_part=3, failures=2)
    plan = _big_plan(tmp_path, 4)

    _upload_resumable(client, "bucket", "key", plan, "abc")

    # Four parts, plus exactly the two retries of part 3, and no restart.
    assert sorted(client.attempts) == [1, 2, 3, 3, 3, 4]
    assert client.created == 1
    assert [p["PartNumber"] for p in client.completed] == [1, 2, 3, 4]


def test_an_interrupted_upload_resumes(tmp_path):
    """Parts already stored are not uploaded again."""
    client = FlakyMultipartClient(existing_parts=(1, 2))
    plan = _big_plan(tmp_path, 4)

    _upload_resumable(client, "bucket", "key", plan, "abc")

    assert client.created == 0, "should reuse the existing upload id"
    assert sorted(client.attempts) == [3, 4], "only the missing parts"
    assert [p["PartNumber"] for p in client.completed] == [1, 2, 3, 4]


def test_a_part_that_never_succeeds_raises(tmp_path, monkeypatch):
    """Exhausting a part's attempts must fail loudly, not complete the upload."""
    monkeypatch.setattr(storage.time, "sleep", lambda _: None)
    client = FlakyMultipartClient(fail_part=2, failures=99)
    plan = _big_plan(tmp_path, 3)

    with pytest.raises(RuntimeError, match="_ssl.c:2406"):
        _upload_resumable(client, "bucket", "key", plan, "abc")

    assert client.completed is None, "must not complete a partial upload"


class PagedPartsClient(FlakyMultipartClient):
    """A stub whose list_parts pages at 1000, the way S3 and R2 actually do.

    Missing this pagination in a monitoring script made healthy uploads look
    frozen at exactly 1000 parts. In the uploader itself the same mistake would
    silently re-upload every part past the first thousand on resume, so the
    behaviour is pinned here.
    """

    PAGE = 1000

    def list_parts(self, **kwargs):
        numbers = sorted(self._existing)
        marker = kwargs.get("PartNumberMarker", 0)
        page = [n for n in numbers if n > marker][: self.PAGE]
        return {
            "Parts": [{"PartNumber": n, "ETag": self._existing[n]} for n in page],
            "IsTruncated": bool([n for n in numbers if n > marker][self.PAGE :]),
            "NextPartNumberMarker": page[-1] if page else marker,
        }


def test_resume_reads_every_page_of_existing_parts(tmp_path):
    """A resume must see parts beyond the first list_parts page."""
    client = PagedPartsClient(existing_parts=range(1, 1201))
    plan = _big_plan(tmp_path, 1300)

    _upload_resumable(client, "bucket", "key", plan, "abc")

    # Only the genuinely missing parts are sent, not everything past 1000.
    assert sorted(client.attempts) == list(range(1201, 1301))
    assert len(client.completed) == 1300
