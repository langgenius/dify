"""Reject new typing.cast and typing_extensions.cast calls in API Python files.

Preconditions: Run from the repository root with Git and ast-grep available.
Use --staged for index contents or --base-rev for committed revisions.
Without either option, inspect local API changes against the main merge base.

Postconditions: Identical existing calls retain their Git baseline.
Copies and changed calls fail. Import aliases and direct assignment aliases
are included. Other libraries' cast functions are outside this rule's scope.
This syntactic rule does not resolve arbitrary assignments or shadowed names.
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


def find_new_cast_calls(
    versions: dict[str, tuple[str, str]],
) -> list[Violation]:
    """Compare cast calls in complete source versions.

    Preconditions: Each key is a repository-relative path with old and new source.
    Postconditions: Return API violations without changing files or source versions.
    Each removed occurrence offsets one identical addition. Scan failures raise.
    """
    rule = rule_path("no_new_cast.yml")
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
            "no-new-cast: use type narrowing or validate values instead of typing.cast().",
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
        violations = find_new_cast_calls(versions)
    except (OSError, RuntimeError) as error:
        sys.stderr.write(f"{error}\n")
        return 2
    print_violations(sorted(violations, key=lambda item: (item.path, item.line_number)))
    return int(bool(violations))


if __name__ == "__main__":
    raise SystemExit(main())
