"""Helpers for producing concise pyrefly diagnostics for CI diff output."""

from __future__ import annotations

import argparse
import sys

_DIAGNOSTIC_PREFIXES = ("ERROR ", "WARN ", "WARNING ")
_LOCATION_PREFIX = "-->"


def extract_diagnostics(raw_output: str) -> str:
    """Extract stable diagnostic lines from pyrefly output.

    The full pyrefly output includes code excerpts and carets, which create noisy
    diffs. This helper keeps only:
    - diagnostic headline lines (``ERROR ...`` / ``WARN ...`` / ``WARNING ...``)
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


def render_diagnostics(raw_output: str, exit_code: int) -> str:
    """Render concise diagnostics and fall back to raw output on unmatched failures."""

    diagnostics = extract_diagnostics(raw_output)
    if diagnostics:
        return diagnostics

    if exit_code != 0:
        return raw_output

    return ""


def main() -> int:
    """Read pyrefly output from stdin and print normalized diagnostics."""

    parser = argparse.ArgumentParser()
    parser.add_argument("--status", type=int, default=0)
    args = parser.parse_args()

    raw_output = sys.stdin.read()
    sys.stdout.write(render_diagnostics(raw_output, exit_code=args.status))
    return 0


if __name__ == "__main__":
    sys.exit(main())
