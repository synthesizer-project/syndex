"""What will be published, decided before anything is.

A plan is the whole of a publication as data: the object key, the metadata
rows, the citations, the axes. It is built first and can be printed, which is
what makes a dry run possible -- and it is why the publisher itself has no
decisions left in it.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from syndex.errors import UploadError
from syndex.inspection import (
    detect_format,
    extract_hdf5,
    extract_instrument_hdf5,
)
from syndex.publish.citations import resolve_citations
from syndex.publish.serialise import json_dump
from syndex.publish.sources import (
    SourceFile,
    merge_metadata,
    override_for,
    safe_prefix,
    sha256_file,
    slug_for,
)

# Dust grids are a separate catalogue type rather than a flavour of "grid":
# they carry attenuation curves or dust emission spectra instead of stellar or
# AGN spectra, so they are classified, prefixed, and filtered separately. Both
# types still populate grid_metadata and grid_axes.
GRID_DATA_TYPES = ("grid", "dust_grid")


def build_plan(
    source: SourceFile,
    defaults: dict[str, Any],
    file_override: dict[str, Any],
) -> dict[str, Any]:
    """Inspect one file and build its complete publication plan.

    Args:
        source: Discovered source file.
        defaults: Batch-level metadata defaults.
        file_override: Higher-precedence metadata for this file.

    Returns:
        Validated, JSON-compatible publication plan.

    Raises:
        UploadError: If classification or required metadata is invalid.
        OSError: If the source file cannot be read.
        ValueError: If metadata cannot be represented as strict JSON.
    """
    # Three sources of truth, merged once: the batch defaults, the per-file
    # override, and the command line ahead of both (already folded into
    # `defaults` by `build_plans`). Everything below reads `config` alone, so
    # no decision further down has to remember which of the three it came from.
    config = merge_metadata(defaults, file_override)
    physical_format = detect_format(source.path)
    extracted_grid = extract_hdf5(source.path) if physical_format == "hdf5" else None
    detected_data_type = None
    if extracted_grid is not None:
        detected_data_type = (
            "dust_grid" if extracted_grid.get("grid_type") == "dust" else "grid"
        )
    # What somebody said beats what the file says. A grid that is a dust grid
    # in all but its attributes is a thing that happens, and being able to say
    # so is the difference between publishing it and editing the file first.
    data_type = config.get("data_type") or detected_data_type
    if not data_type:
        raise UploadError(f"{source.key}: data_type is required for non-grid files")
    if not re.fullmatch(r"[a-z][a-z0-9_]*", data_type):
        raise UploadError(f"{source.key}: invalid data_type {data_type!r}")

    is_test = bool(config.get("is_test", False))
    is_ci = bool(config.get("is_ci", False))
    dataset_name = config.get("name") or slug_for(source.path.stem)
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", dataset_name):
        raise UploadError(f"{source.key}: invalid dataset name {dataset_name!r}")

    grid = None
    if data_type in GRID_DATA_TYPES:
        if extracted_grid is None:
            raise UploadError(
                f"{source.key}: file is not a recognised Synthesizer grid"
            )
        explicit_grid = config.get("grid", {})
        if not isinstance(explicit_grid, dict):
            raise UploadError(f"{source.key}: grid metadata must be an object")
        grid = merge_metadata(extracted_grid, explicit_grid)
        for field in ("grid_type", "emission_type"):
            if not grid.get(field):
                raise UploadError(f"{source.key}: grid.{field} is required")

    instrument = None
    if data_type == "instrument":
        extracted_instrument = (
            extract_instrument_hdf5(source.path) if physical_format == "hdf5" else None
        )
        if extracted_instrument is None:
            raise UploadError(
                f"{source.key}: file is not a recognised Synthesizer instrument cache"
            )
        explicit_instrument = config.get("instrument", {})
        if not isinstance(explicit_instrument, dict):
            raise UploadError(f"{source.key}: instrument metadata must be an object")
        instrument = merge_metadata(extracted_instrument, explicit_instrument)

    # Test data lives under its own prefix rather than being flagged in place,
    # so that a reduced grid published for the test suite can never be reached
    # by a path that looks like science data.
    default_prefix = (
        f"test-data/{data_type.replace('_', '-')}"
        if is_test
        else data_type.replace("_", "-")
    )
    # Bibcodes rather than pasted BibTeX: resolving here means an unknown
    # bibcode fails during planning, before anything is uploaded.
    requested_citations = [
        entry if isinstance(entry, str) else entry.get("bibcode")
        for entry in config.get("citations", [])
    ]
    citations = resolve_citations([b for b in requested_citations if b])

    prefix = safe_prefix(config.get("r2_prefix", default_prefix))
    digest = sha256_file(source.path)
    size = source.path.stat().st_size
    published_at = config.get("published_at") or datetime.now(
        timezone.utc
    ).isoformat().replace("+00:00", "Z")

    plan = {
        "source_path": str(source.path),
        "source_key": source.key,
        "file": {
            "filename": source.path.name,
            "format": physical_format,
            "size_bytes": size,
            "sha256": digest,
            # The digest is in the key, so the same bytes always land on the
            # same object and a republished file overwrites itself rather than
            # accumulating copies. It also means two datasets can carry the
            # same file without either owning it.
            "r2_path": f"{prefix}/{digest}/{source.path.name}",
        },
        "dataset": {
            "name": dataset_name,
            "display_name": config.get("display_name", source.path.stem),
            "description": config.get("description"),
            "data_type": data_type,
            "is_test": is_test,
            "is_ci": is_ci,
            "is_recommended": bool(config.get("is_recommended", False)),
            "licence": config.get("licence"),
            "metadata": config.get("metadata", {}),
        },
        "release": {
            "published_at": published_at,
            "synthesizer_min_version": config.get("synthesizer_min_version"),
            "synthesizer_max_version": config.get("synthesizer_max_version"),
            "provenance": merge_metadata(
                {"hdf5": extracted_grid.get("root_metadata", {})}
                if extracted_grid
                else {},
                config.get("provenance", {}),
            ),
            "set_current": bool(config.get("set_current", False)),
        },
        "grid": grid,
        "instrument": instrument,
        "citations": citations,
    }
    # Serialised and thrown away: the plan is about to be printed as JSON or
    # sent to D1 as JSON, and a NumPy scalar that survived extraction should
    # fail here, where the message names the file, rather than at the point of
    # sending where it would not.
    json_dump(plan)
    return plan


def build_plans(
    sources: Iterable[SourceFile],
    metadata: dict[str, Any],
    cli_defaults: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Build all plans so validation finishes before any cloud mutation.

    Args:
        sources: Discovered files to inspect.
        metadata: Batch defaults and per-file overrides.
        cli_defaults: Command-line defaults overriding metadata-file defaults.

    Returns:
        Pair containing valid plans and validation error messages.
    """
    defaults = merge_metadata(metadata["defaults"], cli_defaults)

    # Every file is planned before any is published, and every failure is
    # collected rather than raised. Publishing a directory of grids should say
    # what is wrong with all of them at once: finding the second problem after
    # fixing the first and re-reading twenty files is an afternoon each time.
    plans = []
    errors = []
    for source in sources:
        try:
            plans.append(
                build_plan(source, defaults, override_for(source, metadata["files"]))
            )
        except Exception as exc:  # noqa: BLE001 - report every invalid batch item
            errors.append(str(exc))
    return plans, errors
