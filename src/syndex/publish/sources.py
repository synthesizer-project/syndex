"""What is being published: the files, and the metadata written about them.

A publication starts from a directory and a YAML-ish metadata file, not from
arguments, so that what was published is a thing somebody can read back and
diff. This is where those two are turned into a list of files each carrying
the metadata that applies to it.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from syndex.errors import UploadError


@dataclass(frozen=True)
class SourceFile:
    """A discovered input file and its metadata lookup key.

    Attributes:
        path: Absolute path to the discovered file.
        key: Path used to find a per-file metadata override.
    """

    path: Path
    key: str


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    """Calculate a file digest without loading the full file.

    Args:
        path: File to hash.
        chunk_size: Number of bytes read per iteration.

    Returns:
        Lowercase hexadecimal SHA-256 digest.

    Raises:
        OSError: If the file cannot be read.
    """
    # Read in chunks because a grid can be tens of gigabytes: this runs on a
    # login node where holding one in memory would be noticed by everybody
    # else on it. The digest is what the catalogue stores to recognise the
    # same bytes arriving twice under different names.
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def slug_for(value: str) -> str:
    """Create a conservative stable dataset name.

    Args:
        value: Source text, normally a filename stem.

    Returns:
        Lowercase, hyphen-separated dataset name.

    Raises:
        UploadError: If no usable characters remain.
    """
    # Deliberately lossy: a dataset name ends up in URLs, in object keys and
    # in `synthesizer-download`, so the only characters allowed are the ones
    # that mean the same thing in all three.
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not slug:
        raise UploadError(f"Cannot derive dataset name from {value!r}")
    return slug


def safe_prefix(prefix: str) -> str:
    """Validate an R2 prefix before incorporating it into an object key.

    Args:
        prefix: Slash-separated R2 key prefix.

    Returns:
        Validated prefix unchanged.

    Raises:
        UploadError: If the prefix is empty, unsafe, or malformed.
    """
    # An allowlist rather than an escape, and checked in three passes so that
    # each rejection is one readable rule. R2 keys are flat strings, so `..`
    # is not a parent directory to it -- but every tool that later mirrors the
    # bucket onto a filesystem will read it as one, and a key that escapes its
    # prefix there is a file written somewhere nobody expected.
    if not prefix or prefix != prefix.strip("/") or "\\" in prefix:
        raise UploadError(f"Unsafe R2 prefix: {prefix!r}")
    parts = prefix.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise UploadError(f"Unsafe R2 prefix: {prefix!r}")
    if any(not re.fullmatch(r"[A-Za-z0-9._-]+", part) for part in parts):
        raise UploadError(f"Unsafe R2 prefix: {prefix!r}")
    return prefix


def merge_metadata(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge metadata dictionaries.

    Args:
        base: Lower-precedence metadata.
        override: Higher-precedence metadata.

    Returns:
        New recursively merged dictionary.
    """
    # Recursive so that a per-file override can set one field of a nested
    # group -- a single citation, say -- without restating the rest of what
    # the defaults put there. A non-dict value replaces rather than merges:
    # overriding a list means giving the list you want, not adding to it.
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merge_metadata(result[key], value)
        else:
            result[key] = value
    return result


def discover_files(
    inputs: Iterable[Path], recursive: bool = False, exclude: Path | None = None
) -> list[SourceFile]:
    """Discover input files in deterministic order.

    Args:
        inputs: Files or directories to inspect.
        recursive: Whether to descend into subdirectories.
        exclude: Optional file to omit, normally the metadata input itself.

    Returns:
        Unique discovered files sorted by absolute path.

    Raises:
        UploadError: If an input path does not exist.
    """
    # Keyed by resolved path so that a file reached twice -- named directly
    # and again through a directory -- is published once. Sorted at the end
    # because the order files are published in is the order they appear in a
    # dry run, and a diff between two runs is only readable if it is stable.
    found: dict[Path, SourceFile] = {}
    excluded = exclude.resolve() if exclude else None
    for raw_path in inputs:
        path = raw_path.expanduser().resolve()
        if not path.exists():
            raise UploadError(f"Input does not exist: {raw_path}")
        if path.is_file():
            if path != excluded:
                found.setdefault(path, SourceFile(path, path.name))
            continue
        iterator = path.rglob("*") if recursive else path.iterdir()
        for child in iterator:
            if child.is_file() and child.resolve() != excluded:
                resolved = child.resolve()
                found.setdefault(
                    resolved, SourceFile(resolved, child.relative_to(path).as_posix())
                )
    return [found[path] for path in sorted(found, key=lambda item: str(item))]


def load_metadata(path: Path | None) -> dict[str, Any]:
    """Load and minimally validate a batch metadata file.

    Args:
        path: JSON metadata path, or ``None`` for empty metadata.

    Returns:
        Dictionary containing ``defaults`` and ``files`` mappings.

    Raises:
        OSError: If the metadata file cannot be read.
        json.JSONDecodeError: If the file does not contain valid JSON.
        UploadError: If the decoded metadata has an invalid structure.
    """
    if path is None:
        return {"defaults": {}, "files": {}}
    with path.open(encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise UploadError("Metadata root must be an object")
    defaults = value.get("defaults", {})
    files = value.get("files", {})
    if not isinstance(defaults, dict) or not isinstance(files, dict):
        raise UploadError("Metadata 'defaults' and 'files' must be objects")
    if any(not isinstance(item, dict) for item in files.values()):
        raise UploadError("Every metadata file override must be an object")
    return {"defaults": defaults, "files": files}


def override_for(source: SourceFile, files: dict[str, Any]) -> dict[str, Any]:
    """Find the most specific metadata override for a discovered file.

    Args:
        source: Discovered file requiring metadata.
        files: Per-file override mapping.

    Returns:
        Matching override, or an empty dictionary when none exists.
    """
    # Most specific first: an absolute path beats the path the file was
    # discovered under, which beats its bare name. Somebody publishing a
    # directory of grids can then write one override for `bpass.hdf5` and a
    # more specific one for the copy of it in a subdirectory.
    for key in (str(source.path), source.key, source.path.name):
        if key in files:
            return files[key]
    return {}
