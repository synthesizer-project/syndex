"""The `syndex-deprecate` command.

Marks a dataset, or one release of it, as no longer the thing to use. Nothing
is removed: the bytes stay downloadable, because something already published
may depend on them. What changes is that the catalogue and the API say so,
with a reason.

    syndex-deprecate bpass-2-2-1 --reason "Superseded by bpass-2-3."
    syndex-deprecate bpass-2-2-1 --release 14 --reason "Wrong axis units."
    syndex-deprecate bpass-2-2-1 --undo

A deprecated release says "use a newer release of this dataset"; a deprecated
dataset says "use something else".
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

from syndex.cloudflare import DEFAULT_ACCOUNT_ID, DEFAULT_DATABASE_ID
from syndex.errors import UploadError
from syndex.previews.store import d1_query


def statement(
    name: str,
    release: int | None,
    reason: str | None,
    when: str | None,
) -> tuple[str, list]:
    """Build the one UPDATE that sets or clears a deprecation.

    Args:
        name: Stable dataset name.
        release: A release of that dataset, or None for the dataset itself.
        reason: Why, or None when clearing.
        when: ISO timestamp to record, or None when clearing.

    Returns:
        The SQL and its bound parameters. The statement returns one row when
        it matched something and none when it did not.
    """
    if release is None:
        return (
            "UPDATE datasets SET deprecated_at = ?, deprecation_reason = ? "
            "WHERE name = ? RETURNING name",
            [when, reason, name],
        )
    # The dataset name is required alongside the release id so that a
    # mistyped id cannot deprecate a release of something else.
    return (
        "UPDATE releases SET deprecated_at = ?, deprecation_reason = ? "
        "WHERE release_id = ? AND dataset_id = "
        "(SELECT dataset_id FROM datasets WHERE name = ?) "
        "RETURNING release_id",
        [when, reason, release, name],
    )


def _parser() -> argparse.ArgumentParser:
    """Build the command-line argument parser.

    Returns:
        Configured argument parser.
    """
    parser = argparse.ArgumentParser(
        prog="syndex-deprecate",
        description=(
            "Mark a dataset, or one release of it, as deprecated in the "
            "Synthesizer data catalogue. Nothing is deleted: the files stay "
            "downloadable and the catalogue says they are deprecated and why."
        ),
    )
    parser.add_argument("name", help="catalogue name of the dataset")
    parser.add_argument(
        "--release",
        type=int,
        help="deprecate only this release id rather than the whole dataset",
    )
    what = parser.add_mutually_exclusive_group(required=True)
    what.add_argument("--reason", help="why, shown to anyone finding it")
    what.add_argument("--undo", action="store_true", help="clear the deprecation")
    parser.add_argument(
        "--account-id",
        default=os.getenv("SYNTHESIZER_CLOUDFLARE_ACCOUNT_ID", DEFAULT_ACCOUNT_ID),
        help="Cloudflare account id (default: %(default)s)",
    )
    parser.add_argument(
        "--database-id",
        default=os.getenv("SYNTHESIZER_D1_DATABASE_ID", DEFAULT_DATABASE_ID),
        help="D1 database to update (default: %(default)s)",
    )
    return parser


def run(argv: list[str] | None = None) -> int:
    """Run the command and return its process status.

    Args:
        argv: Optional arguments excluding the executable name.

    Returns:
        Zero on success, one when D1 refused or nothing matched, two for
        invalid input.
    """
    args = _parser().parse_args(argv)
    if not args.undo and not args.reason.strip():
        print("error: --reason must not be empty", file=sys.stderr)
        return 2

    # From the environment and never an argument, as in `syndex-upload`.
    token = os.getenv("SYNTHESIZER_D1_API_TOKEN")
    if not token:
        print("error: SYNTHESIZER_D1_API_TOKEN is required", file=sys.stderr)
        return 2

    when = None if args.undo else datetime.now(timezone.utc).isoformat()
    reason = None if args.undo else args.reason.strip()
    sql, params = statement(args.name, args.release, reason, when)
    target = args.name if args.release is None else f"{args.name} release {args.release}"
    try:
        rows = d1_query(args.account_id, args.database_id, token, sql, params)
    except UploadError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if not rows:
        print(f"error: no such thing as {target}", file=sys.stderr)
        return 1

    print(f"{target}: {'no longer deprecated' if args.undo else 'deprecated'}")
    return 0


def main() -> None:
    """Run the console-script entry point.

    Raises:
        SystemExit: Always, using the status returned by :func:`run`.
    """
    raise SystemExit(run())


if __name__ == "__main__":
    main()
