"""The `syndex-previews` command.

Three modes, deliberately: with neither flag it lists what it would do,
`--output-dir` renders locally for judging, and `--apply` publishes. Rendering
means reading the grids, which is the expensive part, so the default is the
one that reads nothing.

A manifest is written after every file, so a run over hundreds of grids that
stops half way resumes rather than starting again.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

from syndex.cloudflare import (
    DEFAULT_ACCOUNT_ID,
    DEFAULT_BUCKET,
    DEFAULT_DATABASE_ID,
    s3_client,
)
from syndex.errors import UploadError
from syndex.previews.kinds import make_preview
from syndex.previews.store import CANDIDATE_SQL, d1_query, upload_preview


def _parser() -> argparse.ArgumentParser:
    """Build the command line parser."""
    # Written out rather than taken from `__doc__`, for the same reason as in
    # `plots/cli.py`: the module's docstring is for whoever reads the module.
    parser = argparse.ArgumentParser(
        prog="syndex-previews",
        description=(
            "Render one indicative plot for each catalogue file that can "
            "support one. With neither --output-dir nor --apply it lists what "
            "it would do, since rendering means reading the grids."
        ),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="write PNGs here instead of uploading them, for judging a change",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="upload each preview to R2 and record it on the file row in D1",
    )
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="NAME",
        help="restrict to this dataset; repeatable",
    )
    parser.add_argument("--limit", type=int, help="stop after this many files")
    parser.add_argument(
        "--manifest",
        type=Path,
        help="resume state; defaults to previews-manifest.json beside the output",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="regenerate files the manifest has already recorded",
    )
    parser.add_argument("--account-id", default=DEFAULT_ACCOUNT_ID)
    parser.add_argument("--database-id", default=DEFAULT_DATABASE_ID)
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    return parser


def run(argv: list[str] | None = None) -> int:
    """Generate previews for every candidate file.

    Args:
        argv: Command line arguments, defaulting to ``sys.argv``.

    Returns:
        Process exit status: 0 when nothing failed, 1 otherwise.
    """
    args = _parser().parse_args(argv)
    token = os.getenv("SYNTHESIZER_D1_API_TOKEN")
    if not token:
        raise UploadError(
            "D1 access is required to list candidates (set SYNTHESIZER_D1_API_TOKEN)"
        )

    rows = d1_query(args.account_id, args.database_id, token, CANDIDATE_SQL)
    if args.only:
        wanted = set(args.only)
        rows = [row for row in rows if row["name"] in wanted]
        missing = wanted - {row["name"] for row in rows}
        for name in sorted(missing):
            print(f"  no current release named {name}")

    manifest_path = args.manifest or (
        (args.output_dir or Path(".")) / "previews-manifest.json"
    )
    manifest: dict[str, Any] = (
        json.loads(manifest_path.read_text())
        if manifest_path.exists() and not args.refresh
        else {}
    )

    todo = [row for row in rows if args.refresh or row["name"] not in manifest]
    if args.limit:
        todo = todo[: args.limit]

    # Rendering means reading the grids, which is the expensive part, so a run
    # that would keep nothing lists the work instead of doing it.
    if not args.output_dir and not args.apply:
        for row in todo:
            print(
                f"  {row['name']}  ({row['data_type']}, "
                f"{row['size_bytes'] / 2**20:.0f} MiB)"
            )
        print(
            f"\n  {len(todo)} candidates; pass --output-dir to render locally "
            f"or --apply to publish"
        )
        return 0

    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
    client = s3_client(args.account_id)

    made = omitted = failed = 0

    for position, row in enumerate(todo, start=1):
        name = row["name"]
        started = time.time()
        print(
            f"[{position}/{len(todo)}] {name[:56]} "
            f"({row['size_bytes'] / 2**20:.0f} MiB)",
            flush=True,
        )
        try:
            result = make_preview(client, args.bucket, row)
        except Exception as exc:  # noqa: BLE001 - one bad file must not end a run
            print(f"    FAILED: {type(exc).__name__}: {exc}", flush=True)
            traceback.print_exc()
            manifest[name] = {
                "status": "error",
                "reason": f"{type(exc).__name__}: {exc}"[:200],
            }
            failed += 1
            manifest_path.write_text(json.dumps(manifest, indent=1))
            continue

        if isinstance(result, str):
            print(f"    omitted: {result}", flush=True)
            manifest[name] = {"status": "omitted", "reason": result}
            omitted += 1
            manifest_path.write_text(json.dumps(manifest, indent=1))
            continue

        png, kind = result
        entry: dict[str, Any] = {"status": "ok", "kind": kind, "bytes": len(png)}

        if args.output_dir:
            (args.output_dir / f"{name}.png").write_bytes(png)
            entry["path"] = str(args.output_dir / f"{name}.png")
        if args.apply:
            key = upload_preview(client, args.bucket, png, name, kind)
            d1_query(
                args.account_id,
                args.database_id,
                token,
                "UPDATE files SET preview_path = ?, preview_kind = ? WHERE file_id = ?",
                [key, kind, row["file_id"]],
            )
            entry["preview_path"] = key
        manifest[name] = entry
        made += 1
        manifest_path.write_text(json.dumps(manifest, indent=1))
        print(
            f"    {kind}: {len(png) / 1024:.0f} KB in {time.time() - started:.0f}s",
            flush=True,
        )

    print(f"\n  {made} rendered, {omitted} omitted, {failed} failed", flush=True)
    return 1 if failed else 0


def main() -> None:
    """Entry point for ``syndex-previews``."""
    try:
        sys.exit(run())
    except UploadError as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
