"""Inspect and publish files to the Synthesizer data service."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import h5py
import numpy as np

DEFAULT_ACCOUNT_ID = "e86ac0bb0bee64457c144e84d67966ef"
DEFAULT_BUCKET = "synthesizer-data"
DEFAULT_DATABASE_ID = "6504c716-2065-4b31-8618-453ac12a1144"


@dataclass(frozen=True)
class SourceFile:
    """A discovered input file and its metadata lookup key.

    Attributes:
        path: Absolute path to the discovered file.
        key: Path used to find a per-file metadata override.
    """

    path: Path
    key: str


class UploadError(RuntimeError):
    """Raised for invalid inputs or failed publication."""


def _json_value(value: Any) -> Any:
    """Convert HDF5 and NumPy values to JSON-compatible Python values.

    Args:
        value: Value read from an HDF5 attribute or dataset.

    Returns:
        A value composed only of JSON-compatible Python types.
    """
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, np.generic):
        return _json_value(value.item())
    if isinstance(value, np.ndarray):
        return _json_value(value.tolist())
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value


def _json_dump(value: Any) -> str:
    """Serialize catalogue JSON consistently and reject non-finite numbers.

    Args:
        value: JSON-compatible value to serialize.

    Returns:
        Compact JSON with deterministic key ordering.

    Raises:
        TypeError: If the value contains an unsupported type.
        ValueError: If the value contains a non-finite number.
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _group_metadata(group: h5py.Group) -> dict[str, Any]:
    """Read group attributes recursively without loading datasets.

    Args:
        group: HDF5 group to inspect.

    Returns:
        Nested dictionary containing group attributes.
    """
    result = {str(key): _json_value(value) for key, value in group.attrs.items()}
    for key, value in group.items():
        if isinstance(value, h5py.Group):
            result[str(key)] = _group_metadata(value)
    return result


def detect_format(path: Path) -> str:
    """Detect physical file format from content, then extension.

    Args:
        path: File to inspect.

    Returns:
        Lowercase physical format identifier.

    Raises:
        OSError: If the file cannot be read.
    """
    if h5py.is_hdf5(path):
        return "hdf5"

    with path.open("rb") as stream:
        signature = stream.read(16)

    suffix = path.suffix.lower().lstrip(".")
    if signature.startswith(b"SIMPLE  ="):
        return "fits"
    if signature.startswith(b"PK\x03\x04") or zipfile.is_zipfile(path):
        return "npz" if suffix == "npz" else "zip"
    if signature.startswith(b"\x1f\x8b"):
        return "gzip"
    if suffix in {"json", "yaml", "yml", "csv", "dat", "txt", "pkl"}:
        return suffix
    return suffix or "binary"


def extract_hdf5(path: Path) -> dict[str, Any] | None:
    """Extract Synthesizer grid metadata without reading bulk science arrays.

    Args:
        path: HDF5 file to inspect.

    Returns:
        Extracted grid metadata, or ``None`` when the file is not a recognized
        Synthesizer grid.

    Raises:
        OSError: If an HDF5 file cannot be opened or read.
        ValueError: If extracted metadata cannot be represented safely.
    """
    if not h5py.is_hdf5(path):
        return None

    with h5py.File(path, "r") as hdf:
        is_grid = (
            "axes" in hdf.attrs
            and "axes" in hdf
            and isinstance(hdf["axes"], h5py.Group)
            and ("spectra" in hdf or "extinction_curves" in hdf)
        )
        if not is_grid:
            return None

        axis_names = [_json_value(value) for value in hdf.attrs["axes"]]
        axes = []
        for index, name in enumerate(axis_names):
            axis = hdf[f"axes/{name}"]
            values = _json_value(axis[...])
            axes.append(
                {
                    "axis_index": index,
                    "name": name,
                    "units": _json_value(axis.attrs.get("Units")),
                    "scale": "log"
                    if bool(axis.attrs.get("log_on_read", False))
                    else "linear",
                    "count": len(values),
                    "minimum": min(values) if values else None,
                    "maximum": max(values) if values else None,
                    "values": values,
                }
            )

        spectra_group_name = "spectra" if "spectra" in hdf else "extinction_curves"
        spectra_group = hdf[spectra_group_name]
        available_spectra = sorted(key for key in spectra_group if key != "wavelength")

        # The extinction-curve layout is unambiguous: every Synthesizer grid
        # using this key is a dust attenuation-curve grid. A plain "spectra"
        # group is structurally ambiguous (an unprocessed SPS incident grid
        # looks identical to a dust emission grid), but every dust grid
        # filename contains "dust" by Synthesizer convention, so filename is
        # used as the fallback signal there. Anything else still requires
        # explicit grid_type/emission_type rather than a guess.
        is_dust_filename = "dust" in path.stem.lower()
        detected_grid_type = (
            "dust"
            if spectra_group_name == "extinction_curves" or is_dust_filename
            else None
        )
        if spectra_group_name == "extinction_curves":
            detected_emission_type = "dust_attenuation"
        elif detected_grid_type == "dust":
            detected_emission_type = "dust_emission"
        else:
            detected_emission_type = None

        wavelength = {}
        if "wavelength" in spectra_group:
            wavelength_dataset = spectra_group["wavelength"]
            wavelength_values = wavelength_dataset[...]
            wavelength = {
                "minimum": float(np.min(wavelength_values)),
                "maximum": float(np.max(wavelength_values)),
                "units": _json_value(wavelength_dataset.attrs.get("Units")),
            }

        available_lines = []
        if "lines" in hdf and "id" in hdf["lines"]:
            available_lines = [_json_value(value) for value in hdf["lines/id"][...]]

        root_metadata = {}
        for key in ("date_created", "synthesizer_grids_version", "synthesizer_version"):
            if key in hdf.attrs:
                root_metadata[key] = _json_value(hdf.attrs[key])

        result = {
            "axes": axes,
            "available_spectra": available_spectra,
            "available_lines": available_lines,
            "wavelength": wavelength,
            "model_parameters": _group_metadata(hdf["Model"]) if "Model" in hdf else {},
            "photoionisation_parameters": (
                _group_metadata(hdf["CloudyParams"]) if "CloudyParams" in hdf else {}
            ),
            "root_metadata": root_metadata,
        }
        if detected_grid_type is not None:
            result["grid_type"] = detected_grid_type
        if detected_emission_type is not None:
            result["emission_type"] = detected_emission_type
        return result


def extract_instrument_hdf5(path: Path) -> dict[str, Any] | None:
    """Extract Synthesizer instrument cache metadata structurally.

    This mirrors :func:`extract_hdf5` for grids: it reads the instrument
    serialisation layout written by Synthesizer, without importing
    Synthesizer or constructing real instrument objects. It covers all four
    concrete instrument classes and their capability flags, derived directly
    from ``synthesizer.instruments``:

    - ``photometric`` (:class:`PhotometricInstrument`): integrated photometry
      only. Attributes: filters, depth, depth_app_radius, snrs.
    - ``photometric_imager`` (:class:`PhotometricImager`): photometric plus
      imaging. Attributes: the above, plus resolution, psfs (per filter),
      psf_resample_factor, noise_maps (per filter), noise_source_maps (per
      filter).
    - ``spectroscopic`` (:class:`SpectroscopicInstrument`): one-dimensional
      spectroscopy. Attributes: lam, depth, depth_app_radius, snrs,
      noise_maps (single array), resolving_power (constant values only).
    - ``ifu`` (:class:`IntegratedFieldUnit`): resolved spectroscopy.
      Attributes: lam, resolution, psfs (single array), psf_resample_factor,
      noise_source_maps, depth, depth_app_radius, snrs, resolving_power
      (constant values only).

    Two on-disk layouts exist and are both handled:

    - The generic layout written by ``InstrumentBase.to_hdf5``/
      ``InstrumentCollection.write_instruments``, which tags every group with
      an explicit ``instrument_type`` attribute matching the four types
      above, and a ``Header`` group (skipped) alongside one group per member
      for collections.
    - The lighter-weight layout used by Synthesizer's premade instrument
      cache files, which has no ``instrument_type`` attribute and only ever
      contains ``Filters``, optionally ``Resolution``, and optionally
      ``PSFs`` (verified against every currently downloadable premade cache
      file) — always a ``photometric_imager`` in practice.

    Capability flags mirror ``InstrumentBase``'s properties exactly
    (``can_do_photometry``, ``can_do_imaging``, etc.) computed from which
    optional attributes are present, the same way the real classes compute
    them. Two IFU/spectroscopic capability flags
    (``can_do_noisy_spectroscopy``, ``can_do_psf_spectroscopy``,
    ``can_do_noisy_resolved_spectroscopy``) are hardcoded ``False`` in
    Synthesizer today regardless of stored data, because that functionality
    is not implemented yet; this extractor reports the same hardcoded values
    rather than inferring them from data presence.

    Large arrays (PSFs, noise maps) are never read into metadata: only their
    presence, per-key shape, and units are recorded, the same way grid
    spectra arrays are never read by :func:`extract_hdf5`.

    Args:
        path: HDF5 file to inspect.

    Returns:
        Extracted instrument metadata, or ``None`` when the file does not
        match a recognized instrument layout.

    Raises:
        OSError: If an HDF5 file cannot be opened or read.
    """
    if not h5py.is_hdf5(path):
        return None

    with h5py.File(path, "r") as hdf:
        instrument = _extract_instrument_group(hdf)
        if instrument is not None:
            return instrument

        # No single-instrument layout at the root. This is expected for a
        # collection cache file: a "Header" group (skipped) plus one group
        # per member instrument.
        members = {}
        for key, value in hdf.items():
            if key == "Header" or not isinstance(value, h5py.Group):
                continue
            member = _extract_instrument_group(value)
            if member is not None:
                members[str(key)] = member
        if not members:
            return None
        return {
            "instrument_type": "collection",
            "label": _json_value(hdf.attrs.get("label")),
            "members": members,
        }


def _extract_array_summary(dataset: h5py.Dataset) -> dict[str, Any]:
    """Summarize a bulk array dataset without reading its values.

    Args:
        dataset: HDF5 dataset to summarize.

    Returns:
        Shape and units, never the array contents.
    """
    return {
        "shape": list(dataset.shape),
        "units": _json_value(dataset.attrs.get("units")),
    }


def _walk_leaf_datasets(group: h5py.Group) -> dict[str, h5py.Dataset]:
    """Collect every dataset in a group, keyed by full relative path.

    Filter codes such as ``"JWST/NIRCam.F070W"`` contain a slash, which h5py
    treats as a path separator when used as a dataset name: writing a
    dataset called ``"JWST/NIRCam.F070W"`` actually creates a group
    ``"JWST"`` containing a dataset ``"NIRCam.F070W"``. A plain one-level
    ``.items()`` walk over such a group would therefore miss real per-filter
    entries (or crash trying to read a group as an array), so every per-key
    group in the instrument layout is walked recursively here instead.

    Args:
        group: HDF5 group to walk.

    Returns:
        Mapping of full slash-joined key to leaf dataset.
    """
    leaves: dict[str, h5py.Dataset] = {}
    group.visititems(
        lambda key, obj: (
            leaves.__setitem__(key, obj) if isinstance(obj, h5py.Dataset) else None
        )
    )
    return leaves


def _extract_scalar_or_dict(group: h5py.Group, name: str) -> dict[str, Any] | None:
    """Extract a Depth/SNRs-style attribute that may be scalar or per-key.

    These are always small (one float, or one float per filter/region), so
    values are safe to include directly, unlike PSF/noise arrays.

    Args:
        group: HDF5 group potentially containing the named entry.
        name: Entry name, e.g. ``"Depth"`` or ``"SNRs"``.

    Returns:
        Extracted value, or ``None`` if the entry is absent.
    """
    if name not in group:
        return None
    entry = group[name]
    if isinstance(entry, h5py.Group):
        return {
            "kind": "per_key",
            "values": {
                key: {
                    "value": _json_value(dataset[...]),
                    "units": _json_value(dataset.attrs.get("units")),
                }
                for key, dataset in _walk_leaf_datasets(entry).items()
            },
        }
    return {
        "kind": "scalar",
        "value": _json_value(entry[...]),
        "units": _json_value(entry.attrs.get("units")),
    }


def _extract_array_or_dict(group: h5py.Group, name: str) -> dict[str, Any] | None:
    """Extract a PSFs/NoiseMaps-style attribute without reading bulk arrays.

    Args:
        group: HDF5 group potentially containing the named entry.
        name: Entry name, e.g. ``"PSFs"`` or ``"NoiseMaps"``.

    Returns:
        Presence and shape summary, or ``None`` if the entry is absent.
    """
    if name not in group:
        return None
    entry = group[name]
    if isinstance(entry, h5py.Group):
        return {
            "kind": "per_key",
            "keys": {
                key: _extract_array_summary(dataset)
                for key, dataset in _walk_leaf_datasets(entry).items()
            },
        }
    return {"kind": "single", **_extract_array_summary(entry)}


def _extract_instrument_group(group: h5py.Group) -> dict[str, Any] | None:
    """Extract one instrument's structural metadata from an HDF5 group.

    Args:
        group: HDF5 group or file potentially containing one serialized
            instrument.

    Returns:
        Extracted instrument metadata, or ``None`` if the group matches no
        recognized single-instrument layout (expected at the root of a
        collection cache file).
    """
    tagged_type = _json_value(group.attrs.get("instrument_type"))
    has_filters = "Filters" in group and isinstance(group["Filters"], h5py.Group)
    has_wavelength = "Wavelength" in group and not isinstance(
        group["Wavelength"], h5py.Group
    )
    has_resolution = "Resolution" in group

    if tagged_type is None:
        # The lightweight premade cache layout has no instrument_type
        # attribute and is always a photometric imager in practice (verified
        # against every currently downloadable premade cache file).
        if has_filters:
            tagged_type = "photometric_imager" if has_resolution else "photometric"
        elif has_wavelength:
            tagged_type = "ifu" if has_resolution else "spectroscopic"
        else:
            return None

    label = _json_value(group.attrs.get("label"))
    is_photometric = tagged_type in ("photometric", "photometric_imager")
    is_imager = tagged_type == "photometric_imager"
    is_spectroscopic_family = tagged_type in ("spectroscopic", "ifu")
    is_ifu = tagged_type == "ifu"

    filter_codes: list[Any] = []
    wavelength: dict[str, Any] = {}
    if is_photometric and has_filters:
        header = group["Filters"]["Header"]
        filter_codes = [_json_value(code) for code in header.attrs["filter_codes"]]
        wavelengths = header["Wavelengths"][...]
        wavelength = {
            "minimum": float(np.min(wavelengths)),
            "maximum": float(np.max(wavelengths)),
            "units": _json_value(header.attrs.get("Wavelength_units")),
        }
    elif is_spectroscopic_family and has_wavelength:
        wavelength_dataset = group["Wavelength"]
        wavelengths = wavelength_dataset[...]
        wavelength = {
            "minimum": float(np.min(wavelengths)),
            "maximum": float(np.max(wavelengths)),
            "units": _json_value(wavelength_dataset.attrs.get("units")),
        }

    resolution = None
    if (is_imager or is_ifu) and has_resolution:
        resolution = {
            "value": float(group["Resolution"][...]),
            "units": _json_value(group["Resolution"].attrs.get("units")),
        }

    resolving_power = None
    if is_spectroscopic_family and "resolving_power" in group.attrs:
        resolving_power = float(group.attrs["resolving_power"])

    depth = _extract_scalar_or_dict(group, "Depth")
    depth_app_radius = None
    if "DepthApertureRadius" in group:
        depth_app_radius = {
            "value": _json_value(group["DepthApertureRadius"][...]),
            "units": _json_value(group["DepthApertureRadius"].attrs.get("units")),
        }
    snrs = _extract_scalar_or_dict(group, "SNRs")

    psfs = _extract_array_or_dict(group, "PSFs") if (is_imager or is_ifu) else None
    psf_resample_factor = None
    if (is_imager or is_ifu) and "PSFResampleFactor" in group:
        psf_resample_factor = int(group["PSFResampleFactor"][...])

    noise_maps = _extract_array_or_dict(group, "NoiseMaps")
    noise_source_maps = (
        _extract_array_or_dict(group, "NoiseSourceMaps")
        if (is_imager or is_ifu)
        else None
    )

    # Capability flags mirror InstrumentBase's properties exactly, computed
    # from which optional attributes are present. can_do_noisy_spectroscopy,
    # can_do_psf_spectroscopy, and can_do_noisy_resolved_spectroscopy are
    # hardcoded False in Synthesizer today (not implemented yet), regardless
    # of stored data, so they are reported as False here too rather than
    # inferred.
    capabilities = {
        "can_do_photometry": is_photometric,
        "can_do_imaging": is_imager,
        "can_do_psf_imaging": is_imager and psfs is not None,
        "can_do_noisy_imaging": is_imager
        and (
            noise_maps is not None
            or noise_source_maps is not None
            or (snrs is not None and depth is not None)
        ),
        "can_do_spectroscopy": tagged_type == "spectroscopic",
        "can_do_noisy_spectroscopy": False,
        "can_do_resolved_spectroscopy": is_ifu,
        "can_do_psf_spectroscopy": False,
        "can_do_noisy_resolved_spectroscopy": False,
    }

    return {
        "instrument_type": tagged_type,
        "label": label,
        "capabilities": capabilities,
        "filter_codes": filter_codes,
        "wavelength": wavelength,
        "resolution": resolution,
        "resolving_power": resolving_power,
        "depth": depth,
        "depth_app_radius": depth_app_radius,
        "snrs": snrs,
        "psfs": psfs,
        "psf_resample_factor": psf_resample_factor,
        "noise_maps": noise_maps,
        "noise_source_maps": noise_source_maps,
    }


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
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def _slug(value: str) -> str:
    """Create a conservative stable dataset name.

    Args:
        value: Source text, normally a filename stem.

    Returns:
        Lowercase, hyphen-separated dataset name.

    Raises:
        UploadError: If no usable characters remain.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not slug:
        raise UploadError(f"Cannot derive dataset name from {value!r}")
    return slug


def _safe_prefix(prefix: str) -> str:
    """Validate an R2 prefix before incorporating it into an object key.

    Args:
        prefix: Slash-separated R2 key prefix.

    Returns:
        Validated prefix unchanged.

    Raises:
        UploadError: If the prefix is empty, unsafe, or malformed.
    """
    if not prefix or prefix != prefix.strip("/") or "\\" in prefix:
        raise UploadError(f"Unsafe R2 prefix: {prefix!r}")
    parts = prefix.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise UploadError(f"Unsafe R2 prefix: {prefix!r}")
    if any(not re.fullmatch(r"[A-Za-z0-9._-]+", part) for part in parts):
        raise UploadError(f"Unsafe R2 prefix: {prefix!r}")
    return prefix


def _merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge metadata dictionaries.

    Args:
        base: Lower-precedence metadata.
        override: Higher-precedence metadata.

    Returns:
        New recursively merged dictionary.
    """
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(result[key], value)
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


def _file_override(source: SourceFile, files: dict[str, Any]) -> dict[str, Any]:
    """Find the most specific metadata override for a discovered file.

    Args:
        source: Discovered file requiring metadata.
        files: Per-file override mapping.

    Returns:
        Matching override, or an empty dictionary when none exists.
    """
    for key in (str(source.path), source.key, source.path.name):
        if key in files:
            return files[key]
    return {}


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
    config = _merge(defaults, file_override)
    physical_format = detect_format(source.path)
    extracted_grid = extract_hdf5(source.path) if physical_format == "hdf5" else None
    data_type = config.get("data_type") or ("grid" if extracted_grid else None)
    if not data_type:
        raise UploadError(f"{source.key}: data_type is required for non-grid files")
    if not re.fullmatch(r"[a-z][a-z0-9_]*", data_type):
        raise UploadError(f"{source.key}: invalid data_type {data_type!r}")

    is_test = bool(config.get("is_test", False))
    dataset_name = config.get("name") or _slug(source.path.stem)
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", dataset_name):
        raise UploadError(f"{source.key}: invalid dataset name {dataset_name!r}")

    grid = None
    if data_type == "grid":
        if extracted_grid is None:
            raise UploadError(
                f"{source.key}: file is not a recognized Synthesizer grid"
            )
        explicit_grid = config.get("grid", {})
        if not isinstance(explicit_grid, dict):
            raise UploadError(f"{source.key}: grid metadata must be an object")
        grid = _merge(extracted_grid, explicit_grid)
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
                f"{source.key}: file is not a recognized Synthesizer instrument cache"
            )
        explicit_instrument = config.get("instrument", {})
        if not isinstance(explicit_instrument, dict):
            raise UploadError(f"{source.key}: instrument metadata must be an object")
        instrument = _merge(extracted_instrument, explicit_instrument)

    default_prefix = (
        f"test-data/{data_type.replace('_', '-')}"
        if is_test
        else data_type.replace("_", "-")
    )
    prefix = _safe_prefix(config.get("r2_prefix", default_prefix))
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
            "r2_path": f"{prefix}/{digest}/{source.path.name}",
        },
        "dataset": {
            "name": dataset_name,
            "display_name": config.get("display_name", source.path.stem),
            "description": config.get("description"),
            "data_type": data_type,
            "is_test": is_test,
            "is_recommended": bool(config.get("is_recommended", False)),
            "licence": config.get("licence"),
            "citations": config.get("citations", []),
            "metadata": config.get("metadata", {}),
        },
        "release": {
            "published_at": published_at,
            "synthesizer_min_version": config.get("synthesizer_min_version"),
            "synthesizer_max_version": config.get("synthesizer_max_version"),
            "provenance": _merge(
                {"hdf5": extracted_grid.get("root_metadata", {})}
                if extracted_grid
                else {},
                config.get("provenance", {}),
            ),
            "set_current": bool(config.get("set_current", False)),
        },
        "grid": grid,
        "instrument": instrument,
    }
    _json_dump(plan)
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
    defaults = _merge(metadata["defaults"], cli_defaults)
    plans = []
    errors = []
    for source in sources:
        try:
            plans.append(
                build_plan(source, defaults, _file_override(source, metadata["files"]))
            )
        except Exception as exc:  # noqa: BLE001 - report every invalid batch item
            errors.append(str(exc))
    return plans, errors


def _make_s3_client(account_id: str):
    """Create an R2 S3 client only when a real upload begins.

    Args:
        account_id: Cloudflare account identifier.

    Returns:
        Configured boto3 S3 client using environment credentials.

    Raises:
        UploadError: If boto3 is unavailable.
    """
    try:
        import boto3
    except ImportError as exc:
        raise UploadError("boto3 is required for publication") from exc
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        region_name="auto",
    )


def _head_object(client, bucket: str, key: str) -> dict[str, Any] | None:
    """Return object metadata, treating only missing-key responses as absent.

    Args:
        client: Configured boto3 S3 client.
        bucket: R2 bucket name.
        key: R2 object key.

    Returns:
        Object metadata, or ``None`` when the key does not exist.

    Raises:
        Exception: If R2 returns an error other than a missing object.
    """
    try:
        return client.head_object(Bucket=bucket, Key=key)
    except Exception as exc:
        response = getattr(exc, "response", {})
        code = str(response.get("Error", {}).get("Code", ""))
        status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if code in {"404", "NoSuchKey", "NotFound"} or status == 404:
            return None
        raise


def upload_and_verify(client, bucket: str, plan: dict[str, Any]) -> None:
    """Idempotently upload one file and verify size and digest metadata.

    Args:
        client: Configured boto3 S3 client.
        bucket: Target R2 bucket name.
        plan: Validated publication plan.

    Raises:
        UploadError: If an existing or uploaded object does not match the plan.
        Exception: If the R2 operation fails.
    """
    file_info = plan["file"]
    key = file_info["r2_path"]
    expected_size = file_info["size_bytes"]
    expected_sha = file_info["sha256"]
    head = _head_object(client, bucket, key)
    if head is None:
        client.upload_file(
            plan["source_path"],
            bucket,
            key,
            ExtraArgs={"Metadata": {"sha256": expected_sha}},
        )
        head = _head_object(client, bucket, key)
    if head is None:
        raise UploadError(f"R2 verification failed: {key} is absent")
    actual_sha = head.get("Metadata", {}).get("sha256")
    if head.get("ContentLength") != expected_size or actual_sha != expected_sha:
        raise UploadError(f"R2 object conflicts with publication plan: {key}")


def d1_statements(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Build one transactional D1 batch using parameterized statements.

    Args:
        plan: Validated publication plan.

    Returns:
        Ordered D1 query objects containing SQL and bound parameters.
    """
    file_info = plan["file"]
    dataset = plan["dataset"]
    release = plan["release"]
    statements = [
        {
            "sql": "INSERT INTO files (filename, r2_path, format, size_bytes, sha256) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256) DO UPDATE SET filename = excluded.filename, r2_path = excluded.r2_path, format = excluded.format, size_bytes = excluded.size_bytes",
            "params": [
                file_info["filename"],
                file_info["r2_path"],
                file_info["format"],
                file_info["size_bytes"],
                file_info["sha256"],
            ],
        },
        {
            "sql": "INSERT INTO datasets (name, display_name, description, data_type, is_test, is_recommended, licence, citations_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET display_name = excluded.display_name, description = excluded.description, data_type = excluded.data_type, is_test = excluded.is_test, is_recommended = excluded.is_recommended, licence = excluded.licence, citations_json = excluded.citations_json, metadata_json = excluded.metadata_json",
            "params": [
                dataset["name"],
                dataset["display_name"],
                dataset["description"],
                dataset["data_type"],
                int(dataset["is_test"]),
                int(dataset["is_recommended"]),
                dataset["licence"],
                _json_dump(dataset["citations"]),
                _json_dump(dataset["metadata"]),
            ],
        },
        {
            "sql": "INSERT INTO releases (dataset_id, file_id, published_at, deprecated_at, synthesizer_min_version, synthesizer_max_version, provenance_json) SELECT datasets.dataset_id, files.file_id, ?, NULL, ?, ?, ? FROM datasets, files WHERE datasets.name = ? AND files.sha256 = ? ON CONFLICT(file_id) DO UPDATE SET dataset_id = CASE WHEN releases.dataset_id = excluded.dataset_id THEN releases.dataset_id ELSE NULL END, synthesizer_min_version = excluded.synthesizer_min_version, synthesizer_max_version = excluded.synthesizer_max_version, provenance_json = excluded.provenance_json",
            "params": [
                release["published_at"],
                release["synthesizer_min_version"],
                release["synthesizer_max_version"],
                _json_dump(release["provenance"]),
                dataset["name"],
                file_info["sha256"],
            ],
        },
    ]

    grid = plan["grid"]
    if grid is not None:
        wavelength = grid.get("wavelength", {})
        statements.append(
            {
                "sql": "INSERT INTO grid_metadata (release_id, grid_type, emission_type, model_name, model_version, model_parameters_json, photoionisation_code, photoionisation_code_version, photoionisation_parameters_json, available_spectra_json, available_lines_json, wavelength_min, wavelength_max, wavelength_units, incident_release_id) SELECT releases.release_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM releases JOIN files ON files.file_id = releases.file_id WHERE files.sha256 = ? ON CONFLICT(release_id) DO UPDATE SET grid_type = excluded.grid_type, emission_type = excluded.emission_type, model_name = excluded.model_name, model_version = excluded.model_version, model_parameters_json = excluded.model_parameters_json, photoionisation_code = excluded.photoionisation_code, photoionisation_code_version = excluded.photoionisation_code_version, photoionisation_parameters_json = excluded.photoionisation_parameters_json, available_spectra_json = excluded.available_spectra_json, available_lines_json = excluded.available_lines_json, wavelength_min = excluded.wavelength_min, wavelength_max = excluded.wavelength_max, wavelength_units = excluded.wavelength_units, incident_release_id = excluded.incident_release_id",
                "params": [
                    grid["grid_type"],
                    grid["emission_type"],
                    grid.get("model_name"),
                    grid.get("model_version"),
                    _json_dump(grid.get("model_parameters", {})),
                    grid.get("photoionisation_code"),
                    grid.get("photoionisation_code_version"),
                    _json_dump(grid.get("photoionisation_parameters", {})),
                    _json_dump(grid.get("available_spectra", [])),
                    _json_dump(grid.get("available_lines", [])),
                    wavelength.get("minimum"),
                    wavelength.get("maximum"),
                    wavelength.get("units"),
                    grid.get("incident_release_id"),
                    file_info["sha256"],
                ],
            }
        )
        statements.append(
            {
                "sql": "DELETE FROM grid_axes WHERE release_id = (SELECT releases.release_id FROM releases JOIN files ON files.file_id = releases.file_id WHERE files.sha256 = ?)",
                "params": [file_info["sha256"]],
            }
        )
        for axis in grid["axes"]:
            statements.append(
                {
                    "sql": "INSERT INTO grid_axes (release_id, axis_index, name, units, scale, count, minimum, maximum, values_json) SELECT releases.release_id, ?, ?, ?, ?, ?, ?, ?, ? FROM releases JOIN files ON files.file_id = releases.file_id WHERE files.sha256 = ?",
                    "params": [
                        axis["axis_index"],
                        axis["name"],
                        axis["units"],
                        axis["scale"],
                        axis["count"],
                        axis["minimum"],
                        axis["maximum"],
                        _json_dump(axis["values"]),
                        file_info["sha256"],
                    ],
                }
            )

    instrument = plan["instrument"]
    if instrument is not None:
        wavelength = instrument.get("wavelength", {})
        resolution = instrument.get("resolution") or {}
        depth_app_radius = instrument.get("depth_app_radius") or {}
        statements.append(
            {
                "sql": "INSERT INTO instruments (release_id, instrument_type, label, capabilities_json, filter_codes_json, wavelength_min, wavelength_max, wavelength_units, resolution, resolution_units, resolving_power, depth_json, depth_app_radius, depth_app_radius_units, snrs_json, psfs_json, psf_resample_factor, noise_maps_json, noise_source_maps_json, members_json) SELECT releases.release_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM releases JOIN files ON files.file_id = releases.file_id WHERE files.sha256 = ? ON CONFLICT(release_id) DO UPDATE SET instrument_type = excluded.instrument_type, label = excluded.label, capabilities_json = excluded.capabilities_json, filter_codes_json = excluded.filter_codes_json, wavelength_min = excluded.wavelength_min, wavelength_max = excluded.wavelength_max, wavelength_units = excluded.wavelength_units, resolution = excluded.resolution, resolution_units = excluded.resolution_units, resolving_power = excluded.resolving_power, depth_json = excluded.depth_json, depth_app_radius = excluded.depth_app_radius, depth_app_radius_units = excluded.depth_app_radius_units, snrs_json = excluded.snrs_json, psfs_json = excluded.psfs_json, psf_resample_factor = excluded.psf_resample_factor, noise_maps_json = excluded.noise_maps_json, noise_source_maps_json = excluded.noise_source_maps_json, members_json = excluded.members_json",
                "params": [
                    instrument["instrument_type"],
                    instrument.get("label"),
                    _json_dump(instrument.get("capabilities", {})),
                    _json_dump(instrument.get("filter_codes", [])),
                    wavelength.get("minimum"),
                    wavelength.get("maximum"),
                    wavelength.get("units"),
                    resolution.get("value"),
                    resolution.get("units"),
                    instrument.get("resolving_power"),
                    _json_dump(instrument["depth"])
                    if instrument.get("depth") is not None
                    else None,
                    depth_app_radius.get("value"),
                    depth_app_radius.get("units"),
                    _json_dump(instrument["snrs"])
                    if instrument.get("snrs") is not None
                    else None,
                    _json_dump(instrument["psfs"])
                    if instrument.get("psfs") is not None
                    else None,
                    instrument.get("psf_resample_factor"),
                    _json_dump(instrument["noise_maps"])
                    if instrument.get("noise_maps") is not None
                    else None,
                    _json_dump(instrument["noise_source_maps"])
                    if instrument.get("noise_source_maps") is not None
                    else None,
                    _json_dump(instrument.get("members", {})),
                    file_info["sha256"],
                ],
            }
        )

    if release["set_current"]:
        statements.append(
            {
                "sql": "UPDATE datasets SET current_release_id = (SELECT releases.release_id FROM releases JOIN files ON files.file_id = releases.file_id WHERE files.sha256 = ?) WHERE name = ?",
                "params": [file_info["sha256"], dataset["name"]],
            }
        )
    return statements


def register_d1(
    account_id: str, database_id: str, token: str, plan: dict[str, Any]
) -> None:
    """Register one publication through the D1 transactional batch API.

    Args:
        account_id: Cloudflare account identifier.
        database_id: D1 database identifier.
        token: Cloudflare API token with D1 write access.
        plan: Validated publication plan.

    Raises:
        UploadError: If D1 rejects any statement in the batch.
        urllib.error.URLError: If the D1 API cannot be reached.
    """
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
    body = json.dumps({"batch": d1_statements(plan)}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise UploadError(f"D1 registration failed: HTTP {exc.code}: {detail}") from exc
    if not result.get("success") or any(
        not item.get("success") for item in result.get("result", [])
    ):
        raise UploadError(f"D1 registration failed: {result.get('errors', result)}")


def verify_api(api_url: str, dataset_name: str) -> None:
    """Verify an item through the public API.

    Args:
        api_url: Base URL of the deployed data service.
        dataset_name: Stable dataset name to retrieve.

    Raises:
        UploadError: If the API cannot return the published dataset.
    """
    url = (
        f"{api_url.rstrip('/')}/v1/datasets/{urllib.parse.quote(dataset_name, safe='')}"
    )
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            if response.status != 200:
                raise UploadError(
                    f"API verification failed with HTTP {response.status}"
                )
    except urllib.error.URLError as exc:
        raise UploadError(f"API verification failed: {exc}") from exc


def publish_plan(
    plan: dict[str, Any],
    s3_client,
    bucket: str,
    account_id: str,
    database_id: str,
    token: str,
    api_url: str | None,
) -> None:
    """Publish one fully validated plan in safe cross-service order.

    Args:
        plan: Validated publication plan.
        s3_client: Configured boto3 S3 client.
        bucket: Target R2 bucket name.
        account_id: Cloudflare account identifier.
        database_id: D1 database identifier.
        token: Cloudflare API token with D1 write access.
        api_url: Optional public API base URL for final verification.

    Raises:
        UploadError: If upload, registration, or verification fails.
        Exception: If a cloud client operation fails.
    """
    upload_and_verify(s3_client, bucket, plan)
    register_d1(account_id, database_id, token, plan)
    if api_url:
        verify_api(api_url, plan["dataset"]["name"])


def publish_all(
    plans: Iterable[dict[str, Any]], publish: Callable[[dict[str, Any]], None]
) -> list[tuple[str, str]]:
    """Publish every plan, retaining all per-file failures.

    Args:
        plans: Validated publication plans.
        publish: Function that publishes one plan.

    Returns:
        Source-path and error-message pairs for failed publications.
    """
    failures = []
    for plan in plans:
        try:
            publish(plan)
        except Exception as exc:  # noqa: BLE001 - continue after any publication failure
            failures.append((plan["source_path"], str(exc)))
    return failures


def _parser() -> argparse.ArgumentParser:
    """Build the command-line argument parser.

    Returns:
        Configured argument parser.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--metadata", type=Path, help="JSON batch metadata")
    parser.add_argument("--recursive", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--data-type")
    parser.add_argument(
        "--is-test", action=argparse.BooleanOptionalAction, default=None
    )
    parser.add_argument("--r2-prefix")
    parser.add_argument(
        "--set-current", action=argparse.BooleanOptionalAction, default=None
    )
    parser.add_argument(
        "--account-id", default=os.getenv("CLOUDFLARE_ACCOUNT_ID", DEFAULT_ACCOUNT_ID)
    )
    parser.add_argument(
        "--bucket", default=os.getenv("SYNTHESIZER_R2_BUCKET", DEFAULT_BUCKET)
    )
    parser.add_argument(
        "--database-id",
        default=os.getenv("SYNTHESIZER_D1_DATABASE_ID", DEFAULT_DATABASE_ID),
    )
    parser.add_argument("--api-url", default=os.getenv("SYNTHESIZER_DATA_API_URL"))
    return parser


def run(argv: list[str] | None = None) -> int:
    """Run the upload CLI and return its process status.

    Args:
        argv: Optional arguments excluding the executable name.

    Returns:
        Zero on success, one for publication failures, or two for invalid
        input or client configuration.
    """
    args = _parser().parse_args(argv)
    try:
        metadata_path = args.metadata.expanduser().resolve() if args.metadata else None
        metadata = load_metadata(metadata_path)
        sources = discover_files(args.paths, args.recursive, metadata_path)
        if not sources:
            raise UploadError("No input files found")
        cli_defaults = {
            key: value
            for key, value in {
                "data_type": args.data_type,
                "is_test": args.is_test,
                "r2_prefix": args.r2_prefix,
                "set_current": args.set_current,
            }.items()
            if value is not None
        }
        plans, errors = build_plans(sources, metadata, cli_defaults)
    except Exception as exc:  # noqa: BLE001 - convert CLI errors to status 2
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 2

    print(json.dumps(plans, indent=2, sort_keys=True, allow_nan=False))
    if args.dry_run:
        return 0

    token = os.getenv("CLOUDFLARE_API_TOKEN")
    if not token:
        print("error: CLOUDFLARE_API_TOKEN is required", file=sys.stderr)
        return 2
    try:
        s3_client = _make_s3_client(args.account_id)
    except Exception as exc:  # noqa: BLE001 - convert client setup errors to status 2
        print(f"error: {exc}", file=sys.stderr)
        return 2

    failures = publish_all(
        plans,
        lambda plan: publish_plan(
            plan,
            s3_client,
            args.bucket,
            args.account_id,
            args.database_id,
            token,
            args.api_url,
        ),
    )
    for path, error in failures:
        print(f"error: {path}: {error}", file=sys.stderr)
    return 1 if failures else 0


def main() -> None:
    """Run the console-script entry point.

    Raises:
        SystemExit: Always, using the status returned by :func:`run`.
    """
    raise SystemExit(run())


if __name__ == "__main__":
    main()
