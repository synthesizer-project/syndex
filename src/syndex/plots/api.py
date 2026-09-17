"""Reading the catalogue the way a client reads it.

Through the public API rather than out of D1, so a plot cannot describe
something a reader could not also see -- if a field is missing from the API,
the plot of it is missing too, which is the useful failure.

Every response is cached, because drawing nine plots otherwise means fetching
the whole catalogue nine times, and a missing preview or a wrong axis is
usually three or four runs away from being right.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_API_URL = "https://data.synthesizer-project.org"


def fetch(api_url: str, path: str) -> dict[str, Any]:
    """Fetch one JSON document from the catalogue API.

    Args:
        api_url: Base URL of the data service.
        path: API path beginning with a slash.

    Returns:
        Decoded JSON response.

    Raises:
        RuntimeError: If the API cannot be reached or refuses the request.
    """
    request = urllib.request.Request(
        f"{api_url}{path}",
        # Cloudflare rejects urllib's default agent, so name ourselves.
        headers={"User-Agent": "syndex-plots/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach {api_url}{path}: {exc}") from exc


def load_catalogue(api_url: str, cache: Path, refresh: bool) -> dict[str, Any]:
    """Load every dataset and its full detail, caching the result.

    Args:
        api_url: Base URL of the data service.
        cache: File to read from and write to.
        refresh: Whether to ignore any cached copy.

    Returns:
        Mapping with a `datasets` list and a `details` mapping keyed by name.
    """
    if cache.exists() and not refresh:
        return json.loads(cache.read_text())

    datasets = fetch(api_url, "/v1/datasets?limit=1000")["datasets"]
    details = {}
    for index, dataset in enumerate(datasets, start=1):
        print(f"  fetching {index}/{len(datasets)} {dataset['name']}", flush=True)
        details[dataset["name"]] = fetch(api_url, f"/v1/datasets/{dataset['name']}")

    catalogue = {"datasets": datasets, "details": details}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(catalogue))
    return catalogue


def grids(catalogue: dict[str, Any]) -> list[dict[str, Any]]:
    """Return every published grid release with its metadata.

    Args:
        catalogue: Loaded catalogue.

    Returns:
        List of dataset details whose current release carries grid metadata.
    """
    found = []
    for detail in catalogue["details"].values():
        release = detail.get("current_release")
        if release and release.get("grid"):
            found.append(detail)
    return found


def stellar_grids(catalogue: dict[str, Any]) -> list[tuple[dict, dict]]:
    """Return grid datasets paired with their grid metadata.

    Args:
        catalogue: Loaded catalogue.

    Returns:
        Pairs of dataset detail and grid metadata, dust grids excluded.
    """
    found = []
    for detail in catalogue["details"].values():
        release = detail.get("current_release") or {}
        grid = release.get("grid")
        if grid and detail["data_type"] == "grid":
            found.append((detail, grid))
    return found
