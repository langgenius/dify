"""Require StrEnum instead of new multi-string Literal types in API Python files.

Preconditions: Run from the repository root with Git and ast-grep available.
Use --staged for index contents or --base-rev for committed revisions.
Without either option, inspect local API changes against the main merge base.

Postconditions: Literal types with two or more string arguments are rejected.
Single-value tags and non-string or mixed Literal arguments remain allowed.
Identical existing occurrences and moves retain their Git baseline; copies fail.
Import aliases from typing and typing_extensions are included. This syntactic
rule does not resolve arbitrary assignments or shadowed names.
For an exception, add `# guard-ignore: no-new-multi-string-literal -- <reason>`
on the line where the Literal starts.
Exit codes are 0 for success, 1 for violations, and 2 for check failures.
"""

from __future__ import annotations

import argparse
import ast
import sys
import textwrap
from collections import Counter
from pathlib import Path

from ast_grep_guard import (
    Match,
    Violation,
    filter_moved_matches,
    has_reasoned_guard_ignore,
    match_key,
    print_violations,
    rule_path,
    run_ast_grep,
)
from check_no_new_base_model import working_file_versions
from check_no_new_test_doubles import changed_file_versions

RULE_ID = "no-new-multi-string-literal"


def multi_string_literals(source: str) -> list[Match]:
    """Parse Python source and return unexempted Literal types with multiple string arguments."""
    matches = []
    for match in run_ast_grep(source, rule=rule_path("no_new_multi_string_literal.yml")):
        expression = ast.parse(textwrap.dedent(match.text), mode="eval").body
        if (
            isinstance(expression, ast.Subscript)
            and isinstance(expression.slice, ast.Tuple)
            and len(expression.slice.elts) >= 2
            and all(isinstance(value, ast.Constant) and isinstance(value.value, str) for value in expression.slice.elts)
            and not has_reasoned_guard_ignore(match.source_line, RULE_ID)
        ):
            matches.append(match)
    return matches


def find_new_multi_string_literals(versions: dict[str, tuple[str, str]]) -> list[Violation]:
    """Compare complete source versions and return new API violations without changing files.

    Each removed occurrence offsets one identical addition, including moves between files.
    Parse and scan failures propagate to the CLI as check failures.
    """
    removed: Counter[str] = Counter()
    added = []
    for path, (old_source, new_source) in versions.items():
        if Path(path).is_relative_to("api"):
            existing = Counter(match_key(match) for match in multi_string_literals(old_source))
            for match in multi_string_literals(new_source):
                key = match_key(match)
                if existing[key]:
                    existing[key] -= 1
                else:
                    added.append((path, match))
            removed.update(existing)
    return [
        Violation(
            path,
            match.line_number,
            f"{RULE_ID}: use StrEnum for multiple string alternatives; keep Literal for single-value tags.",
        )
        for path, match in filter_moved_matches(added, removed)
    ]


def main() -> int:
    """Inspect local, staged, or committed changes; return 0, 1, or 2 for success, violations, or failure."""
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--base-rev", help="Compare this revision with committed HEAD.")
    source.add_argument("--staged", action="store_true", help="Compare staged changes with HEAD.")
    args = parser.parse_args()
    try:
        versions = changed_file_versions(args) if args.base_rev or args.staged else working_file_versions()
        violations = find_new_multi_string_literals(versions)
    except (OSError, RuntimeError, SyntaxError) as error:
        sys.stderr.write(f"{error}\n")
        return 2
    print_violations(sorted(violations, key=lambda item: (item.path, item.line_number)))
    return int(bool(violations))


if __name__ == "__main__":
    raise SystemExit(main())
