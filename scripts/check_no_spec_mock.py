#!/usr/bin/env python3
"""Reject spec-based mock constructors in the API, including unchanged files.

Use real model/SDK instances or concrete test fakes. The rule covers explicit
spec/spec_set keywords, positional specs, qualified constructors, import aliases,
and direct constructor aliases. It does not prohibit ordinary method mocks or
create_autospec. Optional paths allow a focused local scan; CI scans all of api/.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from ast_grep_guard import REPO_ROOT, resolve_ast_grep_command, rule_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", type=Path, help="Files or directories to scan (default: api/).")
    args = parser.parse_args()
    paths = args.paths or [REPO_ROOT / "api"]
    try:
        for path in paths:
            if not path.exists():
                raise RuntimeError(f"Scan path does not exist: {path}")
        return subprocess.run(
            [
                *resolve_ast_grep_command(),
                "scan",
                "--rule",
                str(rule_path("no_spec_mock.yml")),
                "--report-style",
                "short",
                *(str(path) for path in paths),
            ],
            check=False,
        ).returncode
    except (OSError, RuntimeError) as exc:
        sys.stderr.write(f"{exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
