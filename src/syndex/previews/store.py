"""Finding what needs a preview, and recording the one that was made.

The candidates are the current release of every dataset and nothing else:
superseded releases are left alone, because the portal only ever shows the
current one and regenerating history would cost days of transfer for images
nothing links to.

Images are content addressed, so regenerating an unchanged plot writes the
same key and costs nothing -- and a changed one writes a new key and leaves
the old object behind, which is a leak to sweep rather than an overwrite to
regret.
"""

from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.request
from typing import Any

from syndex.errors import UploadError

# The current release of every dataset, with everything the choice of plot and
# the D1 update need. Superseded releases are left alone: the portal only ever
# shows the current one, and regenerating history would cost days of transfer
# for images nothing links to.
CANDIDATE_SQL = """
SELECT d.name, d.data_type, f.file_id, f.r2_path, f.size_bytes,
       f.preview_path, f.preview_kind,
       COALESCE(g.has_spectra, 0) AS has_spectra
FROM datasets d
JOIN releases r ON r.release_id = d.current_release_id
JOIN files f ON f.file_id = r.file_id
LEFT JOIN grid_metadata g ON g.release_id = r.release_id
ORDER BY f.size_bytes ASC
"""


def d1_query(
    account_id: str, database_id: str, token: str, sql: str, params: list | None = None
) -> list[dict[str, Any]]:
    """Run one statement against D1 and return its rows.

    Args:
        account_id: Cloudflare account identifier.
        database_id: D1 database identifier.
        token: Cloudflare API token with D1 access.
        sql: The statement.
        params: Bound parameters.

    Returns:
        The result rows as dictionaries.

    Raises:
        UploadError: If D1 rejects the statement.
    """
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/d1/database/{database_id}/query",
        data=json.dumps({"sql": sql, "params": params or []}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise UploadError(f"D1 query failed: HTTP {exc.code}: {detail}") from exc
    if not payload.get("success"):
        raise UploadError(f"D1 query failed: {payload.get('errors', payload)}")
    return payload["result"][0]["results"]


def upload_preview(client, bucket: str, png: bytes, name: str, kind: str) -> str:
    """Store a preview in R2, content addressed, and return its key.

    Content addressing means regenerating an unchanged plot writes the same key
    and costs nothing. It also means a changed plot writes a new key and leaves
    the old object behind, so a failed run leaks silently: sweep orphans by
    comparing the bucket against ``files.preview_path``.

    Args:
        client: Configured boto3 S3 client.
        bucket: R2 bucket name.
        png: The rendered image.
        name: Dataset name, used only for a readable filename.
        kind: The preview kind, recorded as object metadata.

    Returns:
        The R2 object key.
    """
    digest = hashlib.sha256(png).hexdigest()
    key = f"preview/{digest}/{name}.png"
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=png,
        ContentType="image/png",
        Metadata={"sha256": digest, "kind": kind},
    )
    return key
