"""The Cloudflare account these tools talk to, and how to reach its storage.

Defaults rather than settings: one account holds the catalogue, and every
command takes an override for the rare case of a second one. The R2 client is
here too, because publishing a file and rendering a preview of one both need
it and neither should have to import the other to get it.
"""

from __future__ import annotations

import os

from syndex.errors import UploadError

DEFAULT_ACCOUNT_ID = "e86ac0bb0bee64457c144e84d67966ef"

DEFAULT_BUCKET = "synthesizer-data"

DEFAULT_DATABASE_ID = "6504c716-2065-4b31-8618-453ac12a1144"


def s3_client(account_id: str):
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
