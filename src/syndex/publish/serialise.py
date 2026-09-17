"""How the catalogue's JSON is written, everywhere it is written.

One function, because the alternative is `json.dumps` called a dozen times
with whichever arguments were remembered that day. Every JSON column in D1
and every request body this package sends goes through it, so they sort their
keys the same way and none of them can carry a value that is not JSON.
"""

from __future__ import annotations

import json
from typing import Any


def json_dump(value: Any) -> str:
    """Serialise catalogue JSON consistently and reject non-finite numbers.

    Args:
        value: JSON-compatible value to serialise.

    Returns:
        Compact JSON with deterministic key ordering.

    Raises:
        TypeError: If the value contains an unsupported type.
        ValueError: If the value contains a non-finite number.
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
