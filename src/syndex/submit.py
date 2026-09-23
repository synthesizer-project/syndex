"""Send a submitted file from a machine that already has it.

The browser can take anything the catalogue accepts, but it has to be a
browser: the grids that run to tens of gigabytes live on HPC filesystems
reached over SSH, where there is no browser and no desire to copy 30 GB to a
laptop first so that one can be pointed at it.

This sends the same pieces to the same endpoint the browser uses. Nothing here
is a second upload path -- the Worker cannot tell the two apart -- so the
limits, the resumption and the assembling are all the ones already there.

Signing in is GitHub's device flow: this prints a code, somebody types it into
github.com from wherever they happen to be, and the portal issues an ordinary
session in exchange. What is kept on the machine is that session and nothing
else: no password, no key, and nothing that outlives being signed out from the
account page.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Where the portal lives. Overridable so that a development deployment can be
# submitted to without editing anything.
DEFAULT_PORTAL = os.environ.get(
    "SYNDEX_PORTAL", "https://synthesizer-project.org/syndex"
)

# GitHub's device flow endpoints.
DEVICE_CODE = "https://github.com/login/device/code"
DEVICE_TOKEN = "https://github.com/login/oauth/access_token"

# Only what the portal itself asks for. This token is used once, to ask GitHub
# who it belongs to, and never stored.
SCOPES = "read:user user:email"

# Must match PART_SIZE in src/portal/data/submissions.js. R2 requires every part but
# the last to be the same size, so the two are one number in two places rather
# than a setting.
PART_SIZE = 90 * 1024 * 1024

# How many times one piece is re-sent before giving up. Over a transfer of
# hundreds of pieces, one failing somewhere is ordinary.
RETRIES = 3

# What the portal will accept, as a part count. Only used to say so before a
# transfer starts rather than after the last piece is refused; the portal
# enforces it either way. Must match MAX_PARTS in src/portal/data/submissions.js.
MAX_PARTS = 2000


class SubmitError(RuntimeError):
    """Something went wrong that the person running this can act on."""


def _config_path() -> Path:
    """Where the session token is kept.

    Returns:
        Path: The token file, which may not exist yet.
    """
    base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "syndex"
    return base / "session.json"


def _request(
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    method: str | None = None,
) -> tuple[int, bytes]:
    """Make one HTTP request, returning the status rather than raising on it.

    Args:
        url (str): Where to send it.
        data (bytes | None): A body, if any.
        headers (dict[str, str] | None): Headers to send.
        method (str | None): Method, when it is not implied by the body.

    Returns:
        tuple[int, bytes]: The status and the body.

    Raises:
        SubmitError: If the host cannot be reached at all.
    """
    request = urllib.request.Request(
        url, data=data, headers=headers or {}, method=method
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except urllib.error.URLError as error:
        raise SubmitError(f"could not reach {url}: {error.reason}") from error


def _json_request(url: str, payload: dict | None = None, **kwargs) -> tuple[int, dict]:
    """Make one request whose body and answer are both JSON.

    Args:
        url (str): Where to send it.
        payload (dict | None): The body, if any.
        **kwargs: Passed through to :func:`_request`.

    Returns:
        tuple[int, dict]: The status and the decoded answer.
    """
    headers = {"accept": "application/json", **kwargs.pop("headers", {})}
    data = None
    if payload is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(payload).encode()

    status, body = _request(url, data=data, headers=headers, **kwargs)
    try:
        return status, json.loads(body or b"{}")
    except json.JSONDecodeError:
        return status, {}


def sign_in(portal: str) -> str:
    """Get a session, asking GitHub to identify whoever is running this.

    The device flow rather than a browser redirect: the machine holding a 30 GB
    grid is usually one reached over SSH, where opening a browser is not an
    option and neither is a callback URL pointing at localhost.

    Args:
        portal (str): Base URL of the portal.

    Returns:
        str: A session token for the portal.

    Raises:
        SubmitError: If signing in could not be completed.
    """
    status, config = _json_request(f"{portal}/auth/cli")
    client_id = config.get("client_id")
    if status != 200 or not client_id:
        raise SubmitError("this portal is not set up for signing in")

    status, start = _json_request(
        DEVICE_CODE, {"client_id": client_id, "scope": SCOPES}
    )
    if status != 200 or "device_code" not in start:
        raise SubmitError(f"GitHub would not start a sign-in: {start}")

    print(f"\nOpen {start['verification_uri']} and enter this code:\n")
    print(f"    {start['user_code']}\n")
    print("Waiting for you to finish…", flush=True)

    # GitHub says how often to ask and slows us down if we ignore it.
    interval = int(start.get("interval", 5))
    deadline = time.monotonic() + int(start.get("expires_in", 900))

    while time.monotonic() < deadline:
        time.sleep(interval)
        _, answer = _json_request(
            DEVICE_TOKEN,
            {
                "client_id": client_id,
                "device_code": start["device_code"],
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            },
        )

        if "access_token" in answer:
            status, session = _json_request(
                f"{portal}/auth/cli", {"github_token": answer["access_token"]}
            )
            if status != 200:
                raise SubmitError(
                    session.get("error", "the portal refused that sign-in")
                )
            print(f"Signed in as {session['login']}.\n")
            return session["token"]

        error = answer.get("error")
        if error == "authorization_pending":
            continue
        if error == "slow_down":
            interval += 5
            continue
        raise SubmitError(
            f"signing in failed: {answer.get('error_description', error)}"
        )

    raise SubmitError("signing in timed out")


def _stored_token() -> str | None:
    """The session from the last time, if there was one.

    Returns:
        str | None: The token, or None when there is none to read.
    """
    path = _config_path()
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text()).get("token")
    except (OSError, json.JSONDecodeError):
        return None


def _store_token(token: str) -> None:
    """Keep the session for next time, readable only by its owner.

    Args:
        token (str): The session token.
    """
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"token": token}))
    # It is a bearer credential. The default umask would leave it readable by
    # everybody on a shared machine, which an HPC login node is.
    path.chmod(0o600)


def token_for(portal: str) -> str:
    """The session to use, signing in first if there is not one.

    Args:
        portal (str): Base URL of the portal.

    Returns:
        str: A session token.
    """
    token = _stored_token()
    if token is not None:
        return token
    token = sign_in(portal)
    _store_token(token)
    return token


def send(
    portal: str, token: str, upload_token: str, path: Path, *, quiet: bool = False
) -> None:
    """Send one file, a piece at a time.

    Args:
        portal (str): Base URL of the portal.
        token (str): Session token.
        upload_token (str): Which submission the file belongs to.
        path (Path): The file to send.
        quiet (bool): Whether to suppress progress.

    Raises:
        SubmitError: If a piece could not be sent, or the portal refused.
    """
    size = path.stat().st_size
    parts = max(1, -(-size // PART_SIZE))
    if parts > MAX_PARTS:
        raise SubmitError(
            f"{path.name} is {size / 1000**3:.1f} GB, and the portal accepts "
            f"up to {PART_SIZE * MAX_PARTS / 1000**3:.0f} GB"
        )
    sent = 0

    with path.open("rb") as stream:
        for number in range(1, parts + 1):
            chunk = stream.read(PART_SIZE)

            for attempt in range(RETRIES + 1):
                status, answer = _json_request(
                    f"{portal}/submit/{upload_token}/part/{number}",
                    headers={"authorization": f"Bearer {token}"},
                    data=chunk,
                    method="POST",
                )
                if status == 200:
                    break
                # A refusal is the portal's final answer; a 5xx might not be.
                if status < 500 or attempt == RETRIES:
                    raise SubmitError(
                        f"piece {number} was refused: "
                        f"{answer.get('error', f'status {status}')}"
                    )
                time.sleep(2**attempt)

            sent += len(chunk)
            if not quiet:
                percent = int(sent / size * 100) if size else 100
                print(
                    f"\r  {percent:3d}%  piece {number} of {parts}",
                    end="",
                    flush=True,
                )

    if not quiet:
        print("\r  sent, assembling…            ")

    status, answer = _json_request(
        f"{portal}/submit/{upload_token}/complete",
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "application/x-www-form-urlencoded",
        },
        data=f"expected_size={size}".encode(),
        method="POST",
    )
    # The completion answers with a redirect to the submission page, which is
    # a success; anything else is not.
    if status not in (200, 303):
        raise SubmitError(
            answer.get("error", f"the portal answered {status} on completion")
        )


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line parser.

    Separate from :func:`main` so the documentation can render the same
    options the command accepts, rather than a copy that drifts.

    Returns:
        argparse.ArgumentParser: The parser.
    """
    parser = argparse.ArgumentParser(
        prog="syndex-submit",
        description=(
            "Send a file to a submission already registered on the portal. "
            "The token is on that submission's page."
        ),
    )
    parser.add_argument("token", help="the submission's upload token")
    parser.add_argument("path", type=Path, help="the file to send")
    parser.add_argument(
        "--portal",
        default=DEFAULT_PORTAL,
        help="portal to send to (default: %(default)s)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="run the checker on the file before sending it, and stop if it fails",
    )
    parser.add_argument("--quiet", action="store_true", help="no progress output")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Send a file for a submission that has already been described.

    Args:
        argv (list[str] | None): Arguments, or None to read from sys.argv.

    Returns:
        int: 0 on success, 1 on anything the person can act on.
    """
    arguments = build_parser().parse_args(argv)

    if not arguments.path.is_file():
        print(f"{arguments.path}: no such file", file=sys.stderr)
        return 1

    portal = arguments.portal.rstrip("/")

    if arguments.check:
        from syndex.check import check_file

        report = check_file(arguments.path)
        if not report.ok:
            print("This file would not be published as it stands:", file=sys.stderr)
            for error in report.errors:
                print(f"  {error}", file=sys.stderr)
            return 1

    try:
        send(
            portal,
            token_for(portal),
            arguments.token,
            arguments.path,
            quiet=arguments.quiet,
        )
    except SubmitError as error:
        print(f"{error}", file=sys.stderr)
        return 1

    print(f"Sent. {portal}/submit/{arguments.token}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
