"""Work out what a contributed file is.

Classification answers one question -- which catalogue type is this? -- and
deliberately passes no judgement on whether the file is fit to publish. That
separation is what lets the checks be chosen by type rather than guessed at:
a grid is checked against what `grid_metadata` and `grid_axes` require, an
instrument against the `instruments` table, and a file that matches no known
layout is checked against nothing at all, because there is nothing to check.

It is also useful on its own. The submission form pre-fills a data type from
it, the review queue shows a reviewer what the file claimed to be before they
confirm or override it, and neither of those wants a verdict attached.

The classification itself is read out of the file rather than inferred from
its name, with one deliberate exception noted in
:func:`syndex.upload.extract_hdf5`: a plain `spectra` group cannot distinguish
an unprocessed SPS grid from a dust emission grid, so a filename containing
"dust" settles that one case. Everything else comes from what the file says
about itself.
"""

from __future__ import annotations

import contextlib
import io
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from syndex.upload import detect_format, extract_hdf5, extract_instrument_hdf5

# The catalogue types a file can be sorted into. Mirrors the DATA_TYPES list
# the submission form offers, which is the same set the `datasets` table
# stores. Only the first three can be recognised from a file's contents; the
# rest are formats that carry no self-description and are categorised by a
# reviewer.
DATA_TYPES = (
    "grid",
    "dust_grid",
    "instrument",
    "simulation_data",
    "generation_data",
    "synference_data",
    "cache",
)

# What classification can determine without a human. Anything else needs one.
DETECTABLE_TYPES = ("grid", "dust_grid", "instrument")


@dataclass
class Classification:
    """What a file turned out to be.

    Attributes:
        filename (str): The file's basename.
        size_bytes (int): Its size on disk.
        file_format (str): Physical format, as :func:`detect_format` reports it.
        data_type (str | None): The catalogue type, or ``None`` when the file's
            contents identify none and a reviewer must choose.
        reason (str): Why it was classified this way, in a sentence a reviewer
            can weigh against the file in front of them.
        extracted (dict[str, Any]): Everything the extractor read, passed to
            whichever check the type selects. Empty when nothing recognised it.
        summary (dict[str, Any]): The classifying metadata, reduced to what is
            worth showing. Axis values run to thousands of numbers and stay in
            the file.
        error (str | None): Set only when the file could not be read at all,
            which is a fact about the bytes rather than about the metadata and
            so is found here rather than by a check.
    """

    filename: str
    size_bytes: int
    file_format: str
    data_type: str | None = None
    reason: str = ""
    extracted: dict[str, Any] = field(default_factory=dict)
    summary: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


def _summarise_grid(extracted: dict[str, Any]) -> dict[str, Any]:
    """Reduce an extracted grid to what a reviewer needs to see.

    Args:
        extracted (dict[str, Any]): Output of :func:`extract_hdf5`.

    Returns:
        dict[str, Any]: Classifying metadata, without the science arrays.
    """
    return {
        "grid_type": extracted.get("grid_type"),
        "emission_type": extracted.get("emission_type"),
        "model_name": extracted.get("model_name"),
        "model_version": extracted.get("model_version"),
        "photoionisation_code": extracted.get("photoionisation_code"),
        "photoionisation_code_version": extracted.get("photoionisation_code_version"),
        "axes": [
            {"name": axis["name"], "count": axis["count"], "units": axis["units"]}
            for axis in extracted.get("axes", [])
        ],
        "spectra": extracted.get("available_spectra", []),
        "lines": len(extracted.get("available_lines", [])),
        "wavelength": extracted.get("wavelength") or None,
        **extracted.get("root_metadata", {}),
    }


def _summarise_instrument(extracted: dict[str, Any]) -> dict[str, Any]:
    """Reduce an extracted instrument to what a reviewer needs to see.

    Args:
        extracted (dict[str, Any]): Output of :func:`extract_instrument_hdf5`.

    Returns:
        dict[str, Any]: Classifying metadata, without the PSF and noise arrays.
    """
    return {
        "instrument_type": extracted.get("instrument_type"),
        "label": extracted.get("label"),
        "filters": len(extracted.get("filter_codes") or []),
        "members": sorted(extracted.get("members") or {}),
        "capabilities": sorted(
            name for name, held in (extracted.get("capabilities") or {}).items() if held
        ),
    }


def _grid_reason(extracted: dict[str, Any]) -> str:
    """Say what marked a file as the kind of grid it was taken for.

    Args:
        extracted (dict[str, Any]): Output of :func:`extract_hdf5`.

    Returns:
        str: One sentence naming the evidence.
    """
    grid_type = extracted.get("grid_type")
    if grid_type == "dust":
        return (
            "axes and extinction curves, or a filename marking it as dust, "
            "which is how dust grids are distinguished from grids sharing "
            "their layout"
        )
    if grid_type == "sps":
        return f"axes and spectra, with the Model group naming the SPS model {extracted.get('model_name')!r}"
    if grid_type == "agn":
        return "axes and spectra, with the Model group declaring type 'agn'"
    return (
        "axes plus spectra, lines or ionising luminosities, but nothing "
        "identifying which kind of grid it is"
    )


def classify(path: Path) -> Classification:
    """Determine which catalogue type a file belongs to.

    Args:
        path (Path): File to inspect.

    Returns:
        Classification: What the file is, and the metadata that says so. A
        file that cannot be identified is returned with ``data_type`` of None
        rather than raising: needing a human is an outcome, not a failure.

    Raises:
        FileNotFoundError: If the path does not exist.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)

    size_bytes = path.stat().st_size

    # detect_format opens the file, so an unreadable one is caught here rather
    # than surfacing as a traceback out of h5py further down.
    try:
        file_format = detect_format(path)
    except OSError as error:
        return Classification(
            filename=path.name,
            size_bytes=size_bytes,
            file_format="unknown",
            reason="the file could not be opened",
            error=f"the file could not be read: {error}",
        )

    if file_format != "hdf5":
        return Classification(
            filename=path.name,
            size_bytes=size_bytes,
            file_format=file_format,
            reason=(
                f"a {file_format} file, which carries no layout identifying "
                "what it holds"
            ),
        )

    # A truncated or corrupt HDF5 file passes the signature check and fails on
    # read, which is the most likely way a large upload goes wrong. That is a
    # fact about the bytes, so it is recorded here and not left for a check
    # that will never run.
    #
    # The extractors print their convention warnings to stderr, which is what
    # a publisher watching a run wants and what a classification does not: the
    # checks collect the same warnings and own reporting them.
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            grid = extract_hdf5(path)
            instrument = None if grid is not None else extract_instrument_hdf5(path)
    except (OSError, ValueError) as error:
        return Classification(
            filename=path.name,
            size_bytes=size_bytes,
            file_format=file_format,
            reason="the file is HDF5 but could not be read",
            error=(
                "the file is HDF5 but could not be read, which usually means "
                f"it is truncated or corrupt: {error}"
            ),
        )

    if grid is not None:
        # Dust grids are a separate catalogue type rather than a flavour of
        # grid: they carry attenuation curves or dust emission instead of
        # stellar or AGN spectra, and are filtered separately.
        return Classification(
            filename=path.name,
            size_bytes=size_bytes,
            file_format=file_format,
            data_type="dust_grid" if grid.get("grid_type") == "dust" else "grid",
            reason=_grid_reason(grid),
            extracted=grid,
            summary=_summarise_grid(grid),
        )

    if instrument is not None:
        kind = instrument.get("instrument_type")
        return Classification(
            filename=path.name,
            size_bytes=size_bytes,
            file_format=file_format,
            data_type="instrument",
            reason=(
                f"an instrument cache laid out as a {kind}"
                if kind != "collection"
                else "an instrument collection holding "
                f"{len(instrument.get('members') or {})} instruments"
            ),
            extracted=instrument,
            summary=_summarise_instrument(instrument),
        )

    return Classification(
        filename=path.name,
        size_bytes=size_bytes,
        file_format=file_format,
        reason=(
            "HDF5, but neither a Synthesizer grid nor an instrument cache: "
            "simulation output, generation data and caches all look like this"
        ),
    )
