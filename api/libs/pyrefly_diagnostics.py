"""Helpers for producing concise pyrefly diagnostics for CI diff output."""

from __future__ import annotations

import sys

_DIAGNOSTIC_PREFIXES = ("ERROR ", "WARNING ")
_LOCATION_PREFIX = "-->"


def extract_diagnostics(raw_output: str) -> str:
    """Extract stable diagnostic lines from pyrefly output.

    The full pyrefly output includes code excerpts and carets, which create noisy
    diffs. This helper keeps only:
    - diagnostic headline lines (``ERROR ...`` / ``WARNING ...``)
    - the following location line (``--> path:line:column``), when present
    """

    lines = raw_output.splitlines()
    diagnostics: list[str] = []

    for index, line in enumerate(lines):
        if line.startswith(_DIAGNOSTIC_PREFIXES):
            diagnostics.append(line.rstrip())

            next_index = index + 1
            if next_index < len(lines):
                next_line = lines[next_index]
                if next_line.lstrip().startswith(_LOCATION_PREFIX):
                    diagnostics.append(next_line.rstrip())

    if not diagnostics:
        return ""

    return "\n".join(diagnostics) + "\n"


def main() -> int:
    """Read pyrefly output from stdin and print normalized diagnostics."""

    raw_output = sys.stdin.read()
    sys.stdout.write(extract_diagnostics(raw_output))
    return 0


if __name__ == "__main__":
    sys.exit(main())
