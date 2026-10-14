#!/usr/bin/env python3
"""Require TypeBase for new SQLAlchemy model inheritance.

Existing Base subclasses may be edited or migrated. New classes that inherit
from models.base.Base fail, including import aliases and qualified bases.
Class names preserve the baseline even when surrounding lines change. Renames
preserve the baseline through Git's rename detection.

CI compares committed revisions with --base-rev. Local checks inspect the
working tree and untracked Python files against the merge base with main.
Use --staged to inspect only staged changes against HEAD.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

from ast_grep_guard import (
    Violation,
    git_output,
    print_violations,
    rule_path,
    run_ast_grep,
)
from check_no_new_test_doubles import changed_file_versions


def working_file_versions() -> dict[str, tuple[str, str]]:
    baseline = "HEAD"
    for revision in ("upstream/main", "origin/main", "main"):
        merge_base = git_output(
            "merge-base", "HEAD", revision, allow_missing=True
        ).strip()
        if merge_base:
            baseline = merge_base
            break
    paths = set(
        git_output(
            "diff", "--name-only", "-z", "--diff-filter=AMR", baseline, "--", "api"
        )
        .rstrip("\0")
        .split("\0")
    )
    paths.update(
        git_output("ls-files", "--others", "--exclude-standard", "-z", "api")
        .rstrip("\0")
        .split("\0")
    )
    versions = {}
    for path in sorted(paths):
        source = Path(path)
        if source.suffix not in {".py", ".pyi"} or not source.is_file():
            continue
        versions[path] = (
            git_output("show", f"{baseline}:{path}", allow_missing=True),
            source.read_text(),
        )
    return versions


def find_new_base_models(versions: dict[str, tuple[str, str]]) -> list[Violation]:
    rule = rule_path("no_new_base_model.yml")
    violations = []
    for path, (old_source, new_source) in versions.items():
        if not Path(path).is_relative_to("api"):
            continue
        existing = Counter(
            match.meta_variables["NAME"]
            for match in run_ast_grep(old_source, rule=rule)
        )
        for match in run_ast_grep(new_source, rule=rule):
            name = match.meta_variables["NAME"]
            if existing[name]:
                existing[name] -= 1
            else:
                violations.append(
                    Violation(
                        path,
                        match.line_number,
                        f"no-new-base-model: {name} must inherit from TypeBase.",
                    )
                )
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--base-rev", help="Compare this revision with committed HEAD.")
    source.add_argument(
        "--staged", action="store_true", help="Compare staged changes with HEAD."
    )
    args = parser.parse_args()
    try:
        versions = (
            changed_file_versions(args)
            if args.base_rev or args.staged
            else working_file_versions()
        )
        violations = find_new_base_models(versions)
    except (OSError, RuntimeError) as error:
        sys.stderr.write(f"{error}\n")
        return 2
    print_violations(violations)
    return int(bool(violations))


if __name__ == "__main__":
    raise SystemExit(main())
