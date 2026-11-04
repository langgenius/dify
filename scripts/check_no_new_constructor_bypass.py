"""Reject new __new__ calls and references that bypass constructor checks.

Preconditions: Run from the repository root with Git and ast-grep available.
Use --staged for index contents or --base-rev for committed revisions.
Without either option, inspect local API changes against the main merge base.

Postconditions: Existing matching occurrences retain their Git baseline.
Identical moves retain that baseline. Copies and changed calls fail.
Allocation for the first parameter of a class's __new__ method is allowed.
Nested functions and lambdas do not inherit that allocation permission.
This syntactic rule does not resolve dynamic attribute access.
Exit codes are 0 for success, 1 for violations, and 2 for check failures.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

from ast_grep_guard import (
    Violation,
    filter_moved_matches,
    match_key,
    print_violations,
    rule_path,
    run_ast_grep,
)
from check_no_new_base_model import working_file_versions
from check_no_new_test_doubles import changed_file_versions


def find_new_constructor_bypasses(
    versions: dict[str, tuple[str, str]],
) -> list[Violation]:
    """Compare constructor access in complete source versions.

    Preconditions: Each key is a repository-relative path with old and new source.
    Postconditions: Return API violations without changing files or source versions.
    Each removed occurrence offsets one identical addition. Scan failures raise.
    """
    rule = rule_path("no_new_constructor_bypass.yml")
    removed: Counter[str] = Counter()
    added = []
    for path, (old_source, new_source) in versions.items():
        if Path(path).is_relative_to("api"):
            existing = Counter(match_key(match) for match in run_ast_grep(old_source, rule=rule))
            for match in run_ast_grep(new_source, rule=rule):
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
            "no-new-constructor-bypass: use the class constructor to preserve initialization and validation.",
        )
        for path, match in filter_moved_matches(added, removed)
    ]


def main() -> int:
    """Precondition: Git and ast-grep are available in the repository root.

    Postconditions: Report violations without changing repository files.
    Return 0 for success, 1 for violations, or 2 for check failures.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--base-rev", help="Compare this revision with committed HEAD.")
    source.add_argument("--staged", action="store_true", help="Compare staged changes with HEAD.")
    args = parser.parse_args()
    try:
        versions = changed_file_versions(args) if args.base_rev or args.staged else working_file_versions()
        violations = find_new_constructor_bypasses(versions)
    except (OSError, RuntimeError) as error:
        sys.stderr.write(f"{error}\n")
        return 2
    print_violations(sorted(violations, key=lambda item: (item.path, item.line_number)))
    return int(bool(violations))


if __name__ == "__main__":
    raise SystemExit(main())
