"""Recording a published file in D1, and checking the API agrees.

The rows are written as one batch of statements so that a dataset, its
release, its file and its metadata all appear together or not at all -- a
half-written dataset is worse than an absent one, because it is one somebody
can find.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable
from typing import Any

from syndex.errors import UploadError
from syndex.publish.serialise import json_dump
from syndex.publish.storage import upload_and_verify


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

    # Order matters: the file row first, because everything after it finds the
    # release through the digest, and the release finds the file the same way.
    # Nothing here binds a primary key -- D1 runs the batch as one transaction,
    # so the ids do not exist yet when these statements are built, and a SELECT
    # on the digest is what stands in for them.
    #
    # Every statement upserts. Publishing is re-run: a corrected attribute, a
    # refreshed citation, the same file registered again after a failure half
    # way through, all have to land on the row that is already there rather
    # than fail on a constraint or leave a second copy.
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
                json_dump([]),
                json_dump(dataset["metadata"]),
            ],
        },
        {
            "sql": "INSERT INTO releases (dataset_id, file_id, published_at, deprecated_at, synthesizer_min_version, synthesizer_max_version, provenance_json) SELECT datasets.dataset_id, files.file_id, ?, NULL, ?, ?, ? FROM datasets, files WHERE datasets.name = ? AND files.sha256 = ? ON CONFLICT(file_id) DO UPDATE SET dataset_id = CASE WHEN releases.dataset_id = excluded.dataset_id THEN releases.dataset_id ELSE NULL END, synthesizer_min_version = excluded.synthesizer_min_version, synthesizer_max_version = excluded.synthesizer_max_version, provenance_json = excluded.provenance_json",
            "params": [
                release["published_at"],
                release["synthesizer_min_version"],
                release["synthesizer_max_version"],
                json_dump(release["provenance"]),
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
                    json_dump(grid.get("model_parameters", {})),
                    grid.get("photoionisation_code"),
                    grid.get("photoionisation_code_version"),
                    json_dump(grid.get("photoionisation_parameters", {})),
                    json_dump(grid.get("available_spectra", [])),
                    json_dump(grid.get("available_lines", [])),
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
        # Axes are replaced rather than upserted: they are a list, and a grid
        # republished with one axis fewer must not keep the one it lost. The
        # delete and the inserts are in the same batch, so no reader ever sees
        # the gap between them.
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
                        json_dump(axis["values"]),
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
                    json_dump(instrument.get("capabilities", {})),
                    json_dump(instrument.get("filter_codes", [])),
                    wavelength.get("minimum"),
                    wavelength.get("maximum"),
                    wavelength.get("units"),
                    resolution.get("value"),
                    resolution.get("units"),
                    instrument.get("resolving_power"),
                    json_dump(instrument["depth"])
                    if instrument.get("depth") is not None
                    else None,
                    depth_app_radius.get("value"),
                    depth_app_radius.get("units"),
                    json_dump(instrument["snrs"])
                    if instrument.get("snrs") is not None
                    else None,
                    json_dump(instrument["psfs"])
                    if instrument.get("psfs") is not None
                    else None,
                    instrument.get("psf_resample_factor"),
                    json_dump(instrument["noise_maps"])
                    if instrument.get("noise_maps") is not None
                    else None,
                    json_dump(instrument["noise_source_maps"])
                    if instrument.get("noise_source_maps") is not None
                    else None,
                    json_dump(instrument.get("members", {})),
                    file_info["sha256"],
                ],
            }
        )

    # Last, and only when asked. `current_release_id` is what
    # `synthesizer-download` resolves a bare dataset name to, so pointing it at
    # a release is the step that makes a publication visible to everybody --
    # and republishing an old file with `--no-set-current` must not move it.
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
    # The batch endpoint rather than one request per statement: D1 runs a
    # batch as a transaction, which is the whole reason the rows are built as a
    # list. Sent over HTTP rather than through wrangler so that publishing
    # needs a token and not a Node installation.
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
    # D1 answers 200 with per-statement results, so a failed statement is not
    # an HTTP error: both levels have to be checked or a rejected insert would
    # be read as a successful publication.
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
    client,
    bucket: str,
    account_id: str,
    database_id: str,
    token: str,
    api_url: str | None,
) -> None:
    """Publish one fully validated plan in safe cross-service order.

    Args:
        plan: Validated publication plan.
        client: Configured boto3 S3 client.
        bucket: Target R2 bucket name.
        account_id: Cloudflare account identifier.
        database_id: D1 database identifier.
        token: Cloudflare API token with D1 write access.
        api_url: Optional public API base URL for final verification.

    Raises:
        UploadError: If upload, registration, or verification fails.
        Exception: If a cloud client operation fails.
    """
    # Bytes before rows, always. An object nobody references costs storage and
    # is invisible; a row pointing at an object that is not there is a download
    # that fails for everybody, and there is no way to tell from the catalogue
    # which of the two happened.
    upload_and_verify(client, bucket, plan)
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
