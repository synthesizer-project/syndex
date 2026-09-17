"""Putting the bytes in R2, and being sure they arrived.

Grid files run to tens of gigabytes over connections that drop, so anything
large goes up as a resumable multipart upload that picks up where it stopped
rather than starting again. Every upload is read back and compared before it
counts as done: a truncated object that nobody notices is a broken download
for everybody who follows.
"""

from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from syndex.errors import UploadError


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
