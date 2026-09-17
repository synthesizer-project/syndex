"""The exception raised on purpose by inspection and publication.

Its own module because everything from reading a file to registering it
raises this, and importing the publisher to catch an error is the wrong way
round.

`syndex.submit` keeps its own `SubmitError` rather than using this one: it is
a separate tool with a separate audience -- what it reports is "this file did
not reach the portal", not "this file was not published" -- and nothing
catches both.
"""

from __future__ import annotations


class UploadError(RuntimeError):
    """Something an inspection or a publication cannot do, said in one line.

    Carries no fields beyond its message. Everything raising it is reporting
    something the person running the command can act on -- a missing
    attribute, an unsafe prefix, a rejected batch -- and the CLI prints it
    verbatim, so the message is the whole of the interface.
    """
