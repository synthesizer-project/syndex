"""Opening a contributed file and reading what it says about itself.

What a file is comes first -- `detect_format` reads the bytes rather than
trusting the suffix, since a `.hdf5` that is really a zip is a thing that
turns up. Everything past that is HDF5, because grids, dust grids and
instruments all are, and all of them carry their description in attributes
rather than in a manifest alongside. That description is read out here and
turned into ordinary Python, and the file is held against the conventions it
claims to follow.

Nothing here decides anything. A missing attribute is reported as a missing
attribute; whether that stops a file being published is `check.py`, and what
kind of file it is at all is `classify.py`. Both read this module and neither
opens a file itself, so there is one place that knows the layout.
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path
from typing import Any

import h5py
import numpy as np


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
