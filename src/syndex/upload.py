"""Inspect and publish files to the Synthesizer data service."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import h5py
import numpy as np

# Dust grids are a separate catalogue type rather than a flavour of "grid":
# they carry attenuation curves or dust emission spectra instead of stellar or
# AGN spectra, so they are classified, prefixed, and filtered separately. Both
# types still populate grid_metadata and grid_axes.
GRID_DATA_TYPES = ("grid", "dust_grid")

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
    """Serialise catalogue JSON consistently and reject non-finite numbers.

    Args:
        value: JSON-compatible value to serialise.

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

    # An unrecognised suffix is not a format. Raw model inputs are named for
    # what they contain, so "sed.ssz002.rhb" would otherwise be recorded as
    # format "rhb". Fall back to what the bytes are instead.
    try:
        signature.decode("utf-8")
    except UnicodeDecodeError:
        return "binary"
    return "text"


# Axis names follow the plural grid-axis convention; the singular form belongs
# to per-object component attributes. Two published grids escaped with singular
# names and one with dimensionally impossible units, and neither was noticed
# until the whole catalogue was queried at once, so both are checked at publish
# time now. These are warnings rather than errors: a genuinely new axis should
# not be blocked by a list that has not heard of it yet.
_SINGULAR_AXIS_NAMES = {
    "mass": "masses",
    "age": "ages",
    "metallicity": "metallicities",
    "accretion_rate_eddington": "accretion_rates_eddington",
    "cosine_inclination": "cosine_inclinations",
    "ionisation_parameter": "ionisation_parameters",
    "hydrogen_density": "hydrogen_densities",
    "spin": "spins",
    "column_density": "column_densities",
    "turbulence": "turbulences",
}

# Only axes whose dimensions are not in doubt. `units` is compared loosely
# because unyt spells the same unit several ways.
_EXPECTED_AXIS_UNITS = {
    "ages": ("yr", "myr", "gyr", "kyr", "s", "day"),
    "metallicities": ("dimensionless",),
    "accretion_rates_eddington": ("dimensionless",),
    "cosine_inclinations": ("dimensionless",),
    "ionisation_parameters": ("dimensionless",),
}


def check_photoionisation_version(path: Path, version: str | None) -> list[str]:
    """Report a Cloudy version that disagrees with the filename.

    Three grids were published named cloudy-c25.00 while carrying
    `cloudy_version = c23.01` inside, because the generator wrote a stale
    attribute. Nothing detected it until the whole catalogue was grouped by
    version and the new grids turned out to be indistinguishable from the old
    ones. The filename is checked against the attribute at publish time so the
    next one is caught immediately.

    Args:
        path (Path): Source file being published.
        version (str | None): Version recorded inside the file.

    Returns:
        list[str]: One warning if the two disagree, otherwise empty.
    """
    match = re.search(r"cloudy-(c\d+\.\d+)", path.name)
    if match is None or not version:
        return []
    # Compare loosely: a missing "c" prefix is a spelling difference, not a
    # different version.
    named = match.group(1).lstrip("c")
    recorded = str(version).strip().lstrip("c")
    if named == recorded:
        return []
    return [(f"filename says Cloudy {match.group(1)} but the file records {version!r}")]


def check_axis_conventions(axes: list[dict[str, Any]]) -> list[str]:
    """Report axis names and units that break the catalogue's conventions.

    Args:
        axes (list[dict[str, Any]]): Extracted axis records.

    Returns:
        list[str]: One human-readable warning per problem found.
    """
    warnings = []
    for axis in axes:
        name = axis["name"]
        if name in _SINGULAR_AXIS_NAMES:
            warnings.append(
                f"axis '{name}' is singular; grid axes use the plural form "
                f"'{_SINGULAR_AXIS_NAMES[name]}'"
            )

        expected = _EXPECTED_AXIS_UNITS.get(name)
        units = axis.get("units")
        if expected is None or units is None:
            continue
        # A compound unit such as yr**2 shares a prefix with yr, so require the
        # whole string to match one of the accepted spellings.
        if str(units).strip().lower() not in expected:
            warnings.append(
                f"axis '{name}' has units '{units}', expected one of "
                f"{', '.join(expected)}"
            )
    return warnings


def extract_hdf5(path: Path) -> dict[str, Any] | None:
    """Extract Synthesizer grid metadata without reading bulk science arrays.

    Args:
        path: HDF5 file to inspect.

    Returns:
        Extracted grid metadata, or ``None`` when the file is not a recognised
        Synthesizer grid.

    Raises:
        OSError: If an HDF5 file cannot be opened or read.
        ValueError: If extracted metadata cannot be represented safely.
    """
    if not h5py.is_hdf5(path):
        return None

    with h5py.File(path, "r") as hdf:
        # A grid is a set of axes plus something computed over them. That is
        # usually spectra or extinction curves, but lines alone are a normal
        # product, and so are grids holding only ionising luminosities.
        # Requiring spectra would reject both.
        is_grid = (
            "axes" in hdf.attrs
            and "axes" in hdf
            and isinstance(hdf["axes"], h5py.Group)
            and (
                "spectra" in hdf
                or "extinction_curves" in hdf
                or "lines" in hdf
                or "log10_specific_ionising_luminosity" in hdf
            )
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

        for warning in check_axis_conventions(axes):
            print(f"warning: {path.name}: {warning}", file=sys.stderr)

        spectra_group_name = None
        for candidate in ("spectra", "extinction_curves"):
            if candidate in hdf:
                spectra_group_name = candidate
                break
        spectra_group = (
            hdf[spectra_group_name] if spectra_group_name is not None else None
        )
        available_spectra = (
            sorted(key for key in spectra_group if key != "wavelength")
            if spectra_group is not None
            else []
        )

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

        # Wavelength coverage comes from the spectra when there are any, and
        # otherwise from the line wavelengths, so a lines-only grid still
        # reports the range it covers.
        wavelength = {}
        wavelength_source = None
        if spectra_group is not None and "wavelength" in spectra_group:
            wavelength_source = spectra_group
        elif "lines" in hdf and "wavelength" in hdf["lines"]:
            wavelength_source = hdf["lines"]
        if wavelength_source is not None:
            wavelength_dataset = wavelength_source["wavelength"]
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

        model_parameters = _group_metadata(hdf["Model"]) if "Model" in hdf else {}
        photoionisation_parameters = (
            _group_metadata(hdf["CloudyParams"]) if "CloudyParams" in hdf else {}
        )

        # Syncretize records what a grid is, so classification is read rather
        # than guessed. A stellar population grid names its SPS model, an AGN
        # grid declares its type, and any grid processed through a
        # photoionisation code carries that code's parameters. Only when the
        # file says nothing does classification fall back to explicit
        # metadata.
        if detected_grid_type is None:
            if model_parameters.get("type") == "agn":
                detected_grid_type = "agn"
            elif isinstance(model_parameters.get("sps_name"), str):
                detected_grid_type = "sps"
        if detected_emission_type is None and detected_grid_type in (
            "sps",
            "agn",
        ):
            # Reprocessed emission is visible in the spectra a grid carries,
            # which matters because not every model reprocesses through
            # Cloudy: Yggdrasil applies its own nebular treatment and stores
            # no photoionisation parameters at all. A grid holding nothing
            # but incident emission is incident; one carrying nebular,
            # transmitted or line-continuum emission has been reprocessed.
            # Anything else stays unclassified rather than guessed.
            reprocessed = any(
                spectrum.startswith(("nebular", "transmitted", "linecont"))
                for spectrum in available_spectra
            )
            if photoionisation_parameters or reprocessed:
                detected_emission_type = "photoionised"
            elif available_spectra == ["incident"]:
                detected_emission_type = "incident"

        result = {
            "axes": axes,
            "available_spectra": available_spectra,
            "available_lines": available_lines,
            "wavelength": wavelength,
            "model_parameters": model_parameters,
            "photoionisation_parameters": photoionisation_parameters,
            "root_metadata": root_metadata,
        }
        if detected_grid_type is not None:
            result["grid_type"] = detected_grid_type
        if detected_emission_type is not None:
            result["emission_type"] = detected_emission_type

        # The model's identity is recorded in the same place, so lift it into
        # the catalogue columns rather than leaving it buried in JSON.
        model_name = model_parameters.get("sps_name") or model_parameters.get("family")
        if isinstance(model_name, str) and model_name:
            result["model_name"] = model_name
        model_version = model_parameters.get("sps_version")
        if isinstance(model_version, str) and model_version:
            result["model_version"] = model_version
        cloudy_version = photoionisation_parameters.get("cloudy_version")
        if isinstance(cloudy_version, str) and cloudy_version:
            result["photoionisation_code"] = "Cloudy"
            result["photoionisation_code_version"] = cloudy_version
            for warning in check_photoionisation_version(path, cloudy_version):
                print(f"warning: {path.name}: {warning}", file=sys.stderr)

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
        match a recognised instrument layout.

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
    """Summarise a bulk array dataset without reading its values.

    Args:
        dataset: HDF5 dataset to summarise.

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
        group: HDF5 group or file potentially containing one serialised
            instrument.

    Returns:
        Extracted instrument metadata, or ``None`` if the group matches no
        recognised single-instrument layout (expected at the root of a
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


# Citations are supplied as ADS bibcodes and resolved to BibTeX through ADS,
# so that two contributors naming the same paper produce the same record and
# nobody has to paste BibTeX correctly. A personal token raises the rate limit;
# without one, ADS issues an anonymous token which is enough for occasional
# publishing.
USER_AGENT = "syndex-upload/1.0"
ADS_EXPORT_URL = "https://api.adsabs.harvard.edu/v1/export/bibtex"
ADS_BOOTSTRAP_URL = "https://api.adsabs.harvard.edu/v1/accounts/bootstrap"


def _ads_token() -> str:
    """Return an ADS API token, falling back to an anonymous one.

    Returns:
        str: A bearer token for the ADS API.

    Raises:
        UploadError: If no token is configured and ADS will not issue one.
    """
    configured = os.getenv("SYNTHESIZER_ADS_TOKEN")
    if configured:
        return configured
    request = urllib.request.Request(
        ADS_BOOTSTRAP_URL, headers={"User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)["access_token"]
    except Exception as exc:
        raise UploadError(
            "no SYNTHESIZER_ADS_TOKEN set and ADS would not issue an "
            f"anonymous one: {exc}"
        ) from exc


def _bibtex_field(entry: str, field: str) -> str | None:
    """Pull one field out of a BibTeX entry.

    Deliberately small rather than a parser: only the handful of fields needed
    to render a citation without one are extracted, and the verbatim entry
    remains the authoritative record either way.

    Args:
        entry (str): A single BibTeX entry.
        field (str): Field name to extract.

    Returns:
        str | None: The field value with BibTeX braces stripped, or None.
    """
    match = re.search(
        rf"^\s*{field}\s*=\s*(.+?),?\s*$", entry, re.MULTILINE | re.IGNORECASE
    )
    if match is None:
        return None
    value = match.group(1).strip().strip(",").strip()
    # Values arrive as "{...}" or {{...}} or "..."; unwrap whichever it is.
    while value and value[0] in '{"' and value[-1] in '}"':
        value = value[1:-1].strip()
    return re.sub(r"\s+", " ", value.replace("{", "").replace("}", "")) or None


# ADS writes journal names as BibTeX macros, so the extracted field is
# "\\mnras" rather than anything a reader wants to see. Only the journals the
# catalogue actually cites are mapped; an unmapped macro keeps its own name
# minus the backslash, which is still more readable than nothing.
_JOURNAL_MACROS = {
    "mnras": "MNRAS",
    "apj": "ApJ",
    "apjs": "ApJS",
    "apjl": "ApJL",
    "aap": "A&A",
    "pasa": "PASA",
    "pasp": "PASP",
    "aj": "AJ",
    "araa": "ARA&A",
    "nat": "Nature",
    "rmxaa": "RMxAA",
    "rnaas": "RNAAS",
}


def _normalise_journal(value: str | None) -> str | None:
    """Turn an ADS journal macro into something readable.

    Args:
        value (str | None): Journal field as it appears in the BibTeX.

    Returns:
        str | None: A short journal name, or the input if it is already one.
    """
    if not value:
        return None
    macro = value.strip().lstrip("\\").strip()
    return _JOURNAL_MACROS.get(macro.lower(), macro)


def parse_bibtex_entries(bibtex: str) -> dict[str, dict[str, Any]]:
    """Split an ADS BibTeX response into one record per bibcode.

    Args:
        bibtex (str): One or more concatenated BibTeX entries.

    Returns:
        dict[str, dict[str, Any]]: Records keyed by bibcode.
    """
    records = {}
    # Entries start at a line beginning with @TYPE{bibcode,
    starts = [match.start() for match in re.finditer(r"(?m)^@\w+\{", bibtex)]
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(bibtex)
        entry = bibtex[start:end].strip()
        key = re.match(r"^@\w+\{([^,]+),", entry)
        if key is None:
            continue
        bibcode = key.group(1).strip()
        year = _bibtex_field(entry, "year")
        records[bibcode] = {
            "bibcode": bibcode,
            "bibtex": entry,
            "doi": _bibtex_field(entry, "doi"),
            "authors": _bibtex_field(entry, "author"),
            "title": _bibtex_field(entry, "title"),
            "year": int(year) if year and year.isdigit() else None,
            "journal": _normalise_journal(_bibtex_field(entry, "journal")),
        }
    return records


def resolve_citations(bibcodes: list[str]) -> list[dict[str, Any]]:
    """Resolve ADS bibcodes to citation records, preserving the given order.

    Args:
        bibcodes (list[str]): ADS bibcodes to resolve.

    Returns:
        list[dict[str, Any]]: One record per bibcode, in the order supplied.

    Raises:
        UploadError: If ADS rejects the request or resolves nothing for a
            bibcode, since publishing a citation nobody can look up is worse
            than refusing to publish.
    """
    if not bibcodes:
        return []
    request = urllib.request.Request(
        ADS_EXPORT_URL,
        data=_json_dump({"bibcode": list(bibcodes)}).encode(),
        headers={
            "Authorization": f"Bearer {_ads_token()}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        raise UploadError(f"ADS rejected the citation lookup: {exc}") from exc

    records = parse_bibtex_entries(payload.get("export", ""))
    missing = [bibcode for bibcode in bibcodes if bibcode not in records]
    if missing:
        # ADS canonicalises bibcodes, so a request can come back under a
        # different spelling. Say what came back instead of guessing which
        # record was meant: the correct fix is to record the canonical bibcode.
        returned = ", ".join(sorted(records)) or "nothing"
        raise UploadError(
            f"ADS resolved no entry for {', '.join(missing)}; it returned "
            f"{returned}. If a bibcode was canonicalised, use the one ADS "
            "returned."
        )
    return [records[bibcode] for bibcode in bibcodes]


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
    detected_data_type = None
    if extracted_grid is not None:
        detected_data_type = (
            "dust_grid" if extracted_grid.get("grid_type") == "dust" else "grid"
        )
    data_type = config.get("data_type") or detected_data_type
    if not data_type:
        raise UploadError(f"{source.key}: data_type is required for non-grid files")
    if not re.fullmatch(r"[a-z][a-z0-9_]*", data_type):
        raise UploadError(f"{source.key}: invalid data_type {data_type!r}")

    is_test = bool(config.get("is_test", False))
    is_ci = bool(config.get("is_ci", False))
    dataset_name = config.get("name") or _slug(source.path.stem)
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
                f"{source.key}: file is not a recognised Synthesizer instrument cache"
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
    # Bibcodes rather than pasted BibTeX: resolving here means an unknown
    # bibcode fails during planning, before anything is uploaded.
    requested_citations = [
        entry if isinstance(entry, str) else entry.get("bibcode")
        for entry in config.get("citations", [])
    ]
    citations = resolve_citations([b for b in requested_citations if b])

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
            "is_ci": is_ci,
            "is_recommended": bool(config.get("is_recommended", False)),
            "licence": config.get("licence"),
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
        "citations": citations,
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
        Configured boto3 S3 client using the explicit SYNTHESIZER_R2_*
        credentials.

    Raises:
        UploadError: If boto3 is unavailable or credentials are missing.
    """
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise UploadError("boto3 is required for publication") from exc
    access_key = os.getenv("SYNTHESIZER_R2_ACCESS_KEY_ID")
    secret_key = os.getenv("SYNTHESIZER_R2_SECRET_ACCESS_KEY")
    if not access_key or not secret_key:
        raise UploadError(
            "R2 credentials are required (set SYNTHESIZER_R2_ACCESS_KEY_ID "
            "and SYNTHESIZER_R2_SECRET_ACCESS_KEY)"
        )
    # Multi-gigabyte grids upload as hundreds of parts, and a single dropped
    # TLS connection anywhere in that sequence fails the whole transfer.
    # Retrying individual parts turns an hour of wasted transfer into a pause.
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        region_name="auto",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(
            retries={"max_attempts": 10, "mode": "adaptive"},
            connect_timeout=30,
            read_timeout=120,
            max_pool_connections=10,
        ),
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


# Above this size a failed part is expensive enough to be worth uploading the
# file by hand rather than through upload_file. Below it, a restart costs
# seconds and the simpler path is preferable.
RESUMABLE_THRESHOLD_BYTES = 1024**3

# 16 MB parts at concurrency 2, holding 32 MB in flight. Six workers measured
# 1.5 MiB/s against two at 1.25 on the same file, so the extra concurrency
# bought about a fifth: the limit is upstream bandwidth, not this loop. That is
# not worth tripling the memory held during a transfer on a machine already
# swapping heavily, where a large in-flight buffer is what gets a long upload
# killed.
PART_SIZE_BYTES = 16 * 1024 * 1024
PART_CONCURRENCY = 2


def _find_incomplete_upload(client, bucket: str, key: str) -> str | None:
    """Return the id of an unfinished multipart upload for this exact key.

    Args:
        client: Configured boto3 S3 client.
        bucket: Target R2 bucket name.
        key: R2 object key.

    Returns:
        The upload id to resume, or None when there is nothing to resume.
    """
    response = client.list_multipart_uploads(Bucket=bucket, Prefix=key)
    for upload in response.get("Uploads", []):
        if upload["Key"] == key:
            return upload["UploadId"]
    return None


def _completed_parts(client, bucket: str, key: str, upload_id: str) -> dict[int, str]:
    """Map part number to ETag for the parts already stored.

    Args:
        client: Configured boto3 S3 client.
        bucket: Target R2 bucket name.
        key: R2 object key.
        upload_id: Multipart upload being resumed.

    Returns:
        ETags of parts already uploaded, keyed by part number.
    """
    parts, marker = {}, None
    while True:
        request = {"Bucket": bucket, "Key": key, "UploadId": upload_id}
        if marker is not None:
            request["PartNumberMarker"] = marker
        response = client.list_parts(**request)
        for part in response.get("Parts", []):
            parts[part["PartNumber"]] = part["ETag"]
        if not response.get("IsTruncated"):
            return parts
        marker = response.get("NextPartNumberMarker")


def _upload_one_part(
    client,
    bucket: str,
    key: str,
    upload_id: str,
    number: int,
    offset: int,
    size: int,
    source: str,
    attempts: int = 6,
) -> dict[str, Any]:
    """Upload a single part, retrying that part alone on failure.

    This is the whole point of the manual path. A transient TLS failure part
    way through a large upload costs one part here, where upload_file discards
    the entire transfer.

    Args:
        client: Configured boto3 S3 client.
        bucket: Target R2 bucket name.
        key: R2 object key.
        upload_id: Multipart upload to add the part to.
        number: One-based part number.
        offset: Byte offset of the part within the file.
        size: Part length in bytes.
        source: Path of the file being uploaded.
        attempts: How many times to try this part.

    Returns:
        The part number and ETag, as complete_multipart_upload wants them.

    Raises:
        Exception: The last failure, if every attempt for this part fails.
    """
    failure = None
    for attempt in range(1, attempts + 1):
        try:
            # Read per attempt and per part: concurrent parts must not share a
            # file position.
            with open(source, "rb") as handle:
                handle.seek(offset)
                body = handle.read(size)
            response = client.upload_part(
                Bucket=bucket,
                Key=key,
                UploadId=upload_id,
                PartNumber=number,
                Body=body,
            )
            return {"PartNumber": number, "ETag": response["ETag"]}
        except Exception as exc:  # noqa: BLE001 - every failure is retried
            failure = exc
            if attempt == attempts:
                break
            time.sleep(min(2**attempt, 30))
    raise failure


def _upload_resumable(
    client,
    bucket: str,
    key: str,
    plan: dict[str, Any],
    expected_sha: str,
) -> None:
    """Upload a large file part by part, resuming any earlier attempt.

    An unfinished multipart upload for the same key is reused rather than
    replaced, so an interrupted run continues instead of starting again. This
    is safe because the key is content addressed: the same key can only ever
    hold the same bytes, so parts from an earlier attempt are the parts this
    attempt would upload.

    Args:
        client: Configured boto3 S3 client.
        bucket: Target R2 bucket name.
        key: R2 object key.
        plan: Validated publication plan.
        expected_sha: Digest recorded alongside the object.

    Raises:
        UploadError: If the assembled object is not the expected size.
        Exception: If a part fails every attempt.
    """
    source = plan["source_path"]
    total = plan["file"]["size_bytes"]
    upload_id = _find_incomplete_upload(client, bucket, key)
    existing = {}
    if upload_id is None:
        upload_id = client.create_multipart_upload(
            Bucket=bucket, Key=key, Metadata={"sha256": expected_sha}
        )["UploadId"]
    else:
        existing = _completed_parts(client, bucket, key, upload_id)
        if existing:
            print(
                f"  resuming {plan['file']['filename']}: "
                f"{len(existing)} of "
                f"{-(-total // PART_SIZE_BYTES)} parts already uploaded",
                file=sys.stderr,
            )

    pending = []
    for index, offset in enumerate(range(0, total, PART_SIZE_BYTES), start=1):
        if index not in existing:
            pending.append((index, offset, min(PART_SIZE_BYTES, total - offset)))

    parts = [{"PartNumber": n, "ETag": tag} for n, tag in existing.items()]
    if pending:
        with ThreadPoolExecutor(max_workers=PART_CONCURRENCY) as pool:
            futures = [
                pool.submit(
                    _upload_one_part,
                    client,
                    bucket,
                    key,
                    upload_id,
                    number,
                    offset,
                    size,
                    source,
                )
                for number, offset, size in pending
            ]
            # Surfacing the first failure here leaves the upload unfinished on
            # purpose: the next run resumes from the parts that did land.
            for future in futures:
                parts.append(future.result())

    parts.sort(key=lambda part: part["PartNumber"])
    client.complete_multipart_upload(
        Bucket=bucket, Key=key, UploadId=upload_id, MultipartUpload={"Parts": parts}
    )


def _upload_with_retries(
    client,
    bucket: str,
    key: str,
    plan: dict[str, Any],
    expected_sha: str,
    attempts: int = 3,
) -> None:
    """Upload one file, retrying a transfer that dies part way through.

    Small files go through upload_file and are simply retried whole, which
    costs seconds. Large files take the resumable path instead: upload_file
    discards the entire transfer when a part fails hard, and on a 30 GiB grid
    that threw away hours of work repeatedly, so those are uploaded part by
    part with each part retried on its own and any earlier attempt resumed.

    The digest check still decides whether what finally arrives is correct.

    Args:
        client: Configured boto3 S3 client.
        bucket: Target R2 bucket name.
        key: R2 object key.
        plan: Validated publication plan.
        expected_sha: Digest recorded alongside the object.
        attempts: How many times to try before giving up.

    Raises:
        Exception: The last failure, if every attempt fails.
    """
    # Smaller chunks and less concurrency: a dropped connection then costs
    # one part rather than a large in-flight window. Tests drive this with a
    # stub client and no boto3 installed, so the tuning is optional.
    extra = {}
    try:
        from boto3.s3.transfer import TransferConfig

        # 16 MB parts at concurrency 2 keeps the in-flight buffer near 32 MB.
        # Bigger windows cost memory on a machine that may be doing other
        # work, and a dropped connection then wastes more.
        extra["Config"] = TransferConfig(
            multipart_chunksize=16 * 1024 * 1024,
            multipart_threshold=16 * 1024 * 1024,
            max_concurrency=2,
        )
    except ImportError:
        pass

    resumable = plan["file"]["size_bytes"] >= RESUMABLE_THRESHOLD_BYTES and hasattr(
        client, "create_multipart_upload"
    )

    for attempt in range(1, attempts + 1):
        try:
            if resumable:
                _upload_resumable(client, bucket, key, plan, expected_sha)
            else:
                client.upload_file(
                    plan["source_path"],
                    bucket,
                    key,
                    ExtraArgs={"Metadata": {"sha256": expected_sha}},
                    **extra,
                )
            return
        except Exception as exc:
            if attempt == attempts:
                raise
            print(
                f"upload of {plan['file']['filename']} failed on attempt "
                f"{attempt} ({exc}); retrying",
                file=sys.stderr,
            )


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
        _upload_with_retries(client, bucket, key, plan, expected_sha)
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
            "sql": "INSERT INTO datasets (name, display_name, description, data_type, is_test, is_ci, is_recommended, licence, citations_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET display_name = excluded.display_name, description = excluded.description, data_type = excluded.data_type, is_test = excluded.is_test, is_ci = excluded.is_ci, is_recommended = excluded.is_recommended, licence = excluded.licence, citations_json = excluded.citations_json, metadata_json = excluded.metadata_json",
            "params": [
                dataset["name"],
                dataset["display_name"],
                dataset["description"],
                dataset["data_type"],
                int(dataset["is_test"]),
                int(dataset["is_ci"]),
                int(dataset["is_recommended"]),
                dataset["licence"],
                # Superseded by file_citations; see 0006_add_citations.sql.
                _json_dump([]),
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
                "sql": "INSERT INTO grid_metadata (release_id, grid_type, emission_type, model_name, model_version, model_parameters_json, photoionisation_code, photoionisation_code_version, photoionisation_parameters_json, available_spectra_json, available_lines_json, has_spectra, has_lines, wavelength_min, wavelength_max, wavelength_units, incident_release_id) SELECT releases.release_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM releases JOIN files ON files.file_id = releases.file_id WHERE files.sha256 = ? ON CONFLICT(release_id) DO UPDATE SET grid_type = excluded.grid_type, emission_type = excluded.emission_type, model_name = excluded.model_name, model_version = excluded.model_version, model_parameters_json = excluded.model_parameters_json, photoionisation_code = excluded.photoionisation_code, photoionisation_code_version = excluded.photoionisation_code_version, photoionisation_parameters_json = excluded.photoionisation_parameters_json, available_spectra_json = excluded.available_spectra_json, available_lines_json = excluded.available_lines_json, has_spectra = excluded.has_spectra, has_lines = excluded.has_lines, wavelength_min = excluded.wavelength_min, wavelength_max = excluded.wavelength_max, wavelength_units = excluded.wavelength_units, incident_release_id = excluded.incident_release_id",
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
                    int(bool(grid.get("available_spectra"))),
                    int(bool(grid.get("available_lines"))),
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
    # Each paper is stored once and shared. ON CONFLICT on the bibcode means a
    # release paper cited by every grid resolves to the single existing row and
    # picks up any corrected metadata from ADS.
    for position, citation in enumerate(plan.get("citations", [])):
        statements.append(
            {
                "sql": (
                    "INSERT INTO citations (bibcode, doi, bibtex, authors, "
                    "title, year, journal, added_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(bibcode) DO UPDATE SET doi = excluded.doi, "
                    "bibtex = excluded.bibtex, authors = excluded.authors, "
                    "title = excluded.title, year = excluded.year, "
                    "journal = excluded.journal"
                ),
                "params": [
                    citation["bibcode"],
                    citation.get("doi"),
                    citation["bibtex"],
                    citation.get("authors"),
                    citation.get("title"),
                    citation.get("year"),
                    citation.get("journal"),
                    plan["release"]["published_at"],
                ],
            }
        )
        statements.append(
            {
                "sql": (
                    "INSERT INTO file_citations (file_id, citation_id, position) "
                    "SELECT files.file_id, citations.citation_id, ? "
                    "FROM files, citations "
                    "WHERE files.sha256 = ? AND citations.bibcode = ? "
                    "ON CONFLICT(file_id, citation_id) DO UPDATE SET "
                    "position = excluded.position"
                ),
                "params": [
                    position,
                    plan["file"]["sha256"],
                    citation["bibcode"],
                ],
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
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "paths", nargs="+", type=Path, help="files or directories to publish"
    )
    parser.add_argument(
        "--metadata", type=Path, help="JSON file of per-file and batch metadata"
    )
    parser.add_argument(
        "--recursive", action="store_true", help="descend into directories"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="inspect the files and print the plan without contacting Cloudflare",
    )
    parser.add_argument(
        "--data-type",
        help="catalogue data type for files that are not grids, such as instrument",
    )
    parser.add_argument(
        "--is-test",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="mark as reduced test data rather than science data",
    )
    parser.add_argument(
        "--is-ci",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="mark as used by the Synthesizer test suite",
    )
    parser.add_argument(
        "--r2-prefix", help="override the R2 key prefix derived from the data type"
    )
    parser.add_argument(
        "--set-current",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="make this release the dataset's current one (default: yes)",
    )
    parser.add_argument(
        "--account-id",
        default=os.getenv("SYNTHESIZER_CLOUDFLARE_ACCOUNT_ID", DEFAULT_ACCOUNT_ID),
        help="Cloudflare account id (default: %(default)s)",
    )
    parser.add_argument(
        "--bucket",
        default=os.getenv("SYNTHESIZER_R2_BUCKET", DEFAULT_BUCKET),
        help="R2 bucket to upload into (default: %(default)s)",
    )
    parser.add_argument(
        "--database-id",
        default=os.getenv("SYNTHESIZER_D1_DATABASE_ID", DEFAULT_DATABASE_ID),
        help="D1 database to register in (default: %(default)s)",
    )
    parser.add_argument(
        "--api-url",
        default=os.getenv("SYNTHESIZER_DATA_API_URL"),
        help="verify each publication through this API rather than the default",
    )
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
                "is_ci": args.is_ci,
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

    if args.dry_run:
        print(json.dumps(plans, indent=2, sort_keys=True, allow_nan=False))
        return 0

    for plan in plans:
        dataset = plan["dataset"]
        print(
            f"  {dataset['name']}  ({dataset['data_type']}, "
            f"{plan['file']['size_bytes'] / 1024**2:.0f} MiB)"
        )

    token = os.getenv("SYNTHESIZER_D1_API_TOKEN")
    if not token:
        print("error: SYNTHESIZER_D1_API_TOKEN is required", file=sys.stderr)
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
