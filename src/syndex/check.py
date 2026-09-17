"""Judge whether a classified file is fit to publish.

Classification decides what a file is; this decides whether it can be
published as it stands, and the first drives the second. Each catalogue type
has its own rules, because what a grid must carry and what an instrument must
carry have nothing in common, and a file that matches no known layout has no
rules at all beyond being readable.

This is the one validator. A contributor runs it on their own machine before
submitting, so a file with missing metadata is fixed rather than uploaded; the
submission pipeline runs the same command on the uploaded object and records
what it said; and a reviewer runs it again on the file they downloaded. Three
callers, one set of rules, so "it passed for me" and "it passed for the
reviewer" cannot mean different things.

Nothing here re-implements extraction or classification. It asks
:mod:`syndex.classify` what the file is, and reports what the catalogue would
refuse to store.

The distinction that matters throughout:

- An **error** is something that cannot be published as it stands, because a
  column the schema declares ``NOT NULL`` has no value to put in it.
- A **warning** is a convention the file breaks. It does not block anything,
  because a genuinely new axis or a new instrument layout should not be
  rejected by a list that has not heard of it yet.
- An **unrecognised** file is neither. Over a quarter of the catalogue is
  simulation output, caches and generation data in whatever format their
  producer wrote, and there is nothing structural to check in those. They are
  categorised by a human at review, which is the outcome this reports.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from syndex.classify import Classification, classify
from syndex.inspection import check_axis_conventions, check_photoionisation_version

# The instrument types the schema's CHECK constraint allows. Extraction can
# only produce these, but the submission path accepts a report from a version
# of this package it did not install, so the value is confirmed rather than
# trusted.
INSTRUMENT_TYPES = (
    "photometric",
    "photometric_imager",
    "spectroscopic",
    "ifu",
    "collection",
)


@dataclass
class Report:
    """A classification, plus what stands between the file and the catalogue.

    Attributes:
        classification (Classification): What the file was found to be.
        errors (list[str]): Problems that block publication.
        warnings (list[str]): Conventions broken, which do not block anything.
    """

    classification: Classification
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def filename(self) -> str:
        """The file's basename.

        Returns:
            str: The name the file was checked under.
        """
        return self.classification.filename

    @property
    def data_type(self) -> str | None:
        """The catalogue type the file was classified as.

        Returns:
            str | None: The type, or None when a reviewer must choose.
        """
        return self.classification.data_type

    @property
    def ok(self) -> bool:
        """Whether the file could be published as it stands.

        Returns:
            bool: True when nothing blocks publication. An uncategorised file
            is not an error: it needs a human, not a fix.
        """
        return not self.errors

    @property
    def state(self) -> str:
        """The outcome, as the submission queue records it.

        Returns:
            str: ``"failed"`` when something blocks publication,
            ``"ambiguous"`` when the file could not be categorised and a
            reviewer must choose, and ``"passed"`` otherwise.
        """
        if self.errors:
            return "failed"
        if self.data_type is None:
            return "ambiguous"
        return "passed"

    def to_dict(self, verdict: bool = True) -> dict[str, Any]:
        """Render the report as JSON-safe data.

        Args:
            verdict (bool): Whether the checks were run. False when only the
                classification was asked for, which omits the verdict rather
                than reporting an unearned pass: no rules have been applied.

        Returns:
            dict[str, Any]: The report, as posted back to the portal.
        """
        classified = {
            "filename": self.classification.filename,
            "size_bytes": self.classification.size_bytes,
            "format": self.classification.file_format,
            "data_type": self.classification.data_type,
            "reason": self.classification.reason,
            "detected": self.classification.summary,
        }
        if not verdict:
            return classified
        return {
            **classified,
            "state": self.state,
            "errors": self.errors,
            "warnings": self.warnings,
        }


def check_grid(classification: Classification, report: Report) -> None:
    """Judge a grid against what `grid_metadata` and `grid_axes` require.

    Args:
        classification (Classification): A file classified as a grid or a dust
            grid.
        report (Report): Report to add findings to, modified in place.
    """
    extracted = classification.extracted

    # grid_type and emission_type are both NOT NULL, and neither can be
    # guessed from a file that does not say. A grid whose Model group names no
    # SPS model and declares no type is exactly the case the extractor refuses
    # to classify, so say what would settle it rather than only that it is
    # missing.
    if extracted.get("grid_type") is None:
        report.errors.append(
            "the grid does not say what kind of grid it is: no 'type' or "
            "'sps_name' in its Model group, and the filename does not mark it "
            "as dust"
        )
    if extracted.get("emission_type") is None:
        report.errors.append(
            "the grid does not say what emission it holds: it carries no "
            "photoionisation parameters and its spectra are not one of the "
            "recognised sets"
        )

    axes = extracted.get("axes", [])
    if not axes:
        report.errors.append("the grid has no axes")
    report.warnings.extend(check_axis_conventions(axes))
    report.warnings.extend(
        check_photoionisation_version(
            Path(classification.filename),
            extracted.get("photoionisation_code_version"),
        )
    )

    if not extracted.get("model_name"):
        report.warnings.append(
            "no model name could be read, so the grid will not appear under a "
            "model in the catalogue's filters"
        )
    if not extracted.get("wavelength"):
        report.warnings.append(
            "no wavelength coverage could be read from the spectra or lines"
        )
    if "synthesizer_version" not in extracted.get("root_metadata", {}):
        report.warnings.append(
            "the file records no synthesizer_version, so its provenance "
            "cannot be established from the file alone"
        )


def check_instrument(classification: Classification, report: Report) -> None:
    """Judge an instrument against what the `instruments` table requires.

    Args:
        classification (Classification): A file classified as an instrument.
        report (Report): Report to add findings to, modified in place.
    """
    extracted = classification.extracted
    instrument_type = extracted.get("instrument_type")
    if instrument_type not in INSTRUMENT_TYPES:
        report.errors.append(
            f"unrecognised instrument type {instrument_type!r}; expected one "
            f"of {', '.join(INSTRUMENT_TYPES)}"
        )

    if instrument_type == "collection" and not extracted.get("members"):
        report.errors.append("the instrument collection holds no instruments")

    if instrument_type in ("photometric", "photometric_imager") and not extracted.get(
        "filter_codes"
    ):
        report.warnings.append(
            "no filter codes could be read, so the instrument will not be "
            "findable by filter"
        )


# Which checks a file gets, chosen by what it turned out to be. A type absent
# from here has no structural rules to apply, which is the honest answer for
# simulation output and caches rather than a gap: they are read by a person.
CHECKS: dict[str, Callable[[Classification, Report], None]] = {
    "grid": check_grid,
    "dust_grid": check_grid,
    "instrument": check_instrument,
}


def check(classification: Classification) -> Report:
    """Apply the checks a classification selects.

    Args:
        classification (Classification): What the file was found to be.

    Returns:
        Report: The classification with a verdict attached.
    """
    report = Report(classification=classification)

    # An unreadable file is a fact about the bytes that classification already
    # established. No type-specific check can say anything useful about it.
    if classification.error is not None:
        report.errors.append(classification.error)
        return report

    checker = CHECKS.get(classification.data_type or "")
    if checker is None:
        report.warnings.append(
            f"{classification.reason}, so a reviewer will categorise it"
        )
        return report

    checker(classification, report)
    return report


def check_file(path: Path) -> Report:
    """Classify one file and report what would stop it being published.

    Args:
        path (Path): File to inspect.

    Returns:
        Report: What the file is, and what is wrong with it.

    Raises:
        FileNotFoundError: If the path does not exist.
    """
    return check(classify(path))


def _render(report: Report, verdict: bool = True) -> str:
    """Format one report for a terminal.

    Args:
        report (Report): The report to render.
        verdict (bool): Whether the checks were run. False when only the
            classification was asked for, in which case the report must not
            end by pronouncing a file ready: nothing has judged it.

    Returns:
        str: Human-readable lines, without a trailing newline.
    """
    shown_fields = {
        key: value
        for key, value in report.classification.summary.items()
        if value not in (None, [], {}, "")
    }
    # Wide enough for the longest key actually being printed, since
    # "photoionisation_code_version" is more than twice the length of "label"
    # and a fixed width would either wrap it or space everything else out.
    width = max([len(key) for key in shown_fields] + [len("category")])

    lines = [
        report.filename,
        f"  {'format':<{width}}  {report.classification.file_format}",
        f"  {'category':<{width}}  {report.data_type or 'could not be determined'}",
        f"  {'because':<{width}}  {report.classification.reason}",
    ]
    for key, value in shown_fields.items():
        if key == "axes":
            rendered = ", ".join(f"{axis['name']}[{axis['count']}]" for axis in value)
        elif isinstance(value, list):
            rendered = ", ".join(str(item) for item in value)
        elif isinstance(value, dict):
            rendered = json.dumps(value)
        else:
            rendered = str(value)
        lines.append(f"  {key:<{width}}  {rendered}")
    for warning in report.warnings:
        lines.append(f"  warning: {warning}")
    for error in report.errors:
        lines.append(f"  ERROR:   {error}")

    if not verdict:
        lines.append("  not checked: run without --classify-only for a verdict")
    elif report.state == "passed":
        lines.append("  ready to submit")
    elif report.state == "ambiguous":
        lines.append("  ready to submit; a reviewer will categorise it")
    else:
        lines.append("  not ready: fix the errors above, then run this again")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    """Check files named on the command line.

    Args:
        argv (list[str] | None): Arguments, or None to read from sys.argv.

    Returns:
        int: 0 when every file could be published, 1 when any could not.
    """
    parser = argparse.ArgumentParser(
        prog="syndex-check",
        description=(
            "Check a file against what the Synthesizer data catalogue "
            "requires, before submitting it."
        ),
    )
    parser.add_argument("paths", nargs="+", type=Path, help="Files to check.")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Write the reports as JSON, for a machine to read.",
    )
    parser.add_argument(
        "--classify-only",
        action="store_true",
        help="Say what each file is, without checking whether it can be published.",
    )
    arguments = parser.parse_args(argv)

    reports = []
    for path in arguments.paths:
        try:
            classification = classify(path)
        except FileNotFoundError:
            print(f"{path}: no such file", file=sys.stderr)
            return 1
        reports.append(
            Report(classification=classification)
            if arguments.classify_only
            else check(classification)
        )

    verdict = not arguments.classify_only
    if arguments.json:
        payload = [report.to_dict(verdict=verdict) for report in reports]
        # One file is the overwhelmingly common case and the submission
        # pipeline reads exactly one, so do not make it unwrap a list.
        print(json.dumps(payload[0] if len(payload) == 1 else payload, indent=2))
    else:
        print("\n\n".join(_render(report, verdict=verdict) for report in reports))

    return 0 if all(report.ok for report in reports) else 1


if __name__ == "__main__":
    raise SystemExit(main())
