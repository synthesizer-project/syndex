"""Reading one HDF5 object out of R2 without downloading it.

A grid runs to tens of gigabytes and a preview needs a few hundred megabytes
of it, so the file is opened over HTTP range requests: h5py asks for the bytes
it wants, this fetches those, and nothing else moves. A run over the whole
catalogue transfers a few percent of what the catalogue weighs.
"""

from __future__ import annotations

import io
from collections import OrderedDict

import h5py

# Reading whole leading axes at a time keeps h5py's slicing simple; this bounds
# how much of one grid is resident while that happens.
READ_BUDGET_BYTES = 256 << 20


class R2File(io.RawIOBase):
    """Seekable read-only file over an R2 object, with a block cache.

    h5py seeks constantly, and an uncached reader re-fetches the same regions:
    reading a 14.5 MB file that way cost 21.5 MB of transfer. Caching aligned
    blocks makes the transfer roughly the bytes actually needed.
    """

    BLOCK = 4 << 20
    MAX_BLOCKS = 64

    def __init__(self, client, bucket: str, key: str, size: int):
        """Wrap one R2 object.

        Args:
            client: Configured boto3 S3 client.
            bucket: R2 bucket name.
            key: R2 object key.
            size: Object size in bytes, which bounds every read.
        """
        self._client, self._bucket, self._key = client, bucket, key
        self._size, self._pos = size, 0
        self._blocks: OrderedDict[int, bytes] = OrderedDict()
        self.fetched = 0

    def readable(self) -> bool:
        """Report that the file can be read."""
        return True

    def seekable(self) -> bool:
        """Report that the file can be seeked, which h5py requires."""
        return True

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        """Move the read position, clamped to the object.

        Args:
            offset: Byte offset relative to ``whence``.
            whence: One of the ``io.SEEK_*`` constants.

        Returns:
            The new absolute position.
        """
        base = {
            io.SEEK_SET: 0,
            io.SEEK_CUR: self._pos,
            io.SEEK_END: self._size,
        }[whence]
        self._pos = max(0, min(self._size, base + offset))
        return self._pos

    def tell(self) -> int:
        """Return the current read position."""
        return self._pos

    def _block(self, index: int) -> bytes:
        """Return one aligned block, fetching it if it is not cached.

        Args:
            index: Block number, counting from the start of the object.

        Returns:
            The block's bytes, shorter than ``BLOCK`` only for the last one.
        """
        if index in self._blocks:
            self._blocks.move_to_end(index)
            return self._blocks[index]
        start = index * self.BLOCK
        end = min(start + self.BLOCK, self._size) - 1
        data = self._client.get_object(
            Bucket=self._bucket, Key=self._key, Range=f"bytes={start}-{end}"
        )["Body"].read()
        self.fetched += len(data)
        self._blocks[index] = data
        while len(self._blocks) > self.MAX_BLOCKS:
            self._blocks.popitem(last=False)
        return data

    def readinto(self, buffer) -> int:
        """Fill ``buffer`` from the cached blocks covering the read.

        Args:
            buffer: Writable buffer to fill.

        Returns:
            Number of bytes written, 0 at end of file.
        """
        want = min(len(buffer), self._size - self._pos)
        if want <= 0:
            return 0
        written = 0
        while written < want:
            index = (self._pos + written) // self.BLOCK
            block = self._block(index)
            offset = (self._pos + written) - index * self.BLOCK
            take = min(len(block) - offset, want - written)
            if take <= 0:
                break
            buffer[written : written + take] = block[offset : offset + take]
            written += take
        self._pos += written
        return written


def open_r2(client, bucket: str, key: str, size: int):
    """Open an R2 object as an HDF5 file without downloading it.

    Args:
        client: Configured boto3 S3 client.
        bucket: R2 bucket name.
        key: R2 object key.
        size: Object size in bytes.

    Returns:
        A tuple of the open ``h5py.File`` and the underlying ``R2File``, whose
        ``fetched`` attribute reports how much was actually transferred.
    """
    handle = R2File(client, bucket, key, size)
    return h5py.File(io.BufferedReader(handle, buffer_size=1 << 20), "r"), handle
