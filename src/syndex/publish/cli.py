"""The `syndex-upload` command.

Argument parsing and the order the steps run in, and nothing else: everything
it does is a function in one of the other modules, so that the same steps can
be run from a script without going through a command line.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from syndex.cloudflare import (
    DEFAULT_ACCOUNT_ID,
    DEFAULT_BUCKET,
    DEFAULT_DATABASE_ID,
    s3_client,
)
from syndex.errors import UploadError
from syndex.publish.plan import build_plans
from syndex.publish.registry import publish_all, publish_plan
from syndex.publish.sources import discover_files, load_metadata


def _parser() -> argparse.ArgumentParser:
    """Build the command-line argument parser.

    Returns:
        Configured argument parser.
    """
    # Written out rather than taken from `__doc__`: this is what somebody
    # reading `--help` sees, and the module's own docstring is written for
    # somebody reading the module.
    parser = argparse.ArgumentParser(
        prog="syndex-upload",
        description=(
            "Inspect files, then publish them to the Synthesizer data "
            "catalogue: the bytes to R2 and the metadata to D1. Use --dry-run "
            "to see exactly what would be published without contacting "
            "Cloudflare."
        ),
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
    # Every flag that could also be written in the metadata file takes
    # `default=None` rather than a real default, because the three sources are
    # merged by precedence later: a default here would be indistinguishable
    # from somebody asking for it, and would silently beat the metadata file.
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

    # Everything that can fail on the strength of the arguments alone happens
    # in this block, and answers 2: nothing has been uploaded or written, so
    # it is worth distinguishing from a publication that failed half way.
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

    # The whole plan, sorted, as the last thing that happens before anything
    # leaves the machine. `allow_nan=False` because a NaN read out of a grid
    # would be written as the bare token `NaN`, which is not JSON: better to
    # fail here than to store something no parser will read back.
    if args.dry_run:
        print(json.dumps(plans, indent=2, sort_keys=True, allow_nan=False))
        return 0

    for plan in plans:
        dataset = plan["dataset"]
        print(
            f"  {dataset['name']}  ({dataset['data_type']}, "
            f"{plan['file']['size_bytes'] / 1024**2:.0f} MiB)"
        )

    # Read from the environment and never from an argument: it would
    # otherwise be in the shell history of every machine this is run from, and
    # in the process list of every machine it is run on.
    token = os.getenv("SYNTHESIZER_D1_API_TOKEN")
    if not token:
        print("error: SYNTHESIZER_D1_API_TOKEN is required", file=sys.stderr)
        return 2
    try:
        client = s3_client(args.account_id)
    except Exception as exc:  # noqa: BLE001 - convert client setup errors to status 2
        print(f"error: {exc}", file=sys.stderr)
        return 2

    # One failure does not stop the batch. Publishing twenty grids is an
    # afternoon, and losing nineteen of them because the fourth had a bad
    # attribute would mean starting again rather than fixing the one.
    failures = publish_all(
        plans,
        lambda plan: publish_plan(
            plan,
            client,
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
