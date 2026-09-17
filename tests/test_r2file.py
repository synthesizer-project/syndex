"""Tests for reading an HDF5 object out of R2 over range requests.

The client here is a bytes object that records every range it is asked for,
because what matters is not that the right bytes come back -- any file object
manages that -- but how many requests it took and how much was transferred.
A preview that pulls a 26 GiB grid down in full still produces a correct
picture, and is still a bug.
"""

import io

from syndex.previews.r2 import R2File


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
    handle = R2File(client, "bucket", "key", len(payload))
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
    handle = R2File(client, "bucket", "key", len(payload))
    handle.BLOCK = 4096

    for _ in range(5):
        handle.seek(100)
        assert handle.read(10) == b"x" * 10
    assert len(client.ranges) == 1


def test_r2file_clamps_seeks_to_the_object():
    handle = R2File(FakeR2(b"abc"), "bucket", "key", 3)
    assert handle.seek(-100) == 0
    assert handle.seek(100) == 3
    assert handle.seek(-1, io.SEEK_END) == 2
