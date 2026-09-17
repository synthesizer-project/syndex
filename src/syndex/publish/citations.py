"""Turning bibcodes into the citations the catalogue stores.

A dataset is asked for the papers it should be cited as, by bibcode, and ADS
is asked for the BibTeX. Storing the resolved entry rather than the bibcode
means the catalogue can render a citation without reaching ADS on every page
view, and keeps working when ADS does not.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from syndex.errors import UploadError
from syndex.publish.serialise import json_dump

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
        data=json_dump({"bibcode": list(bibcodes)}).encode(),
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
