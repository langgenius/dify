#!/usr/bin/env python3
"""Block net-new getattr() usage in staged changes or against an explicit base revision."""

from __future__ import annotations

from ast_grep_guard import Match, has_reasoned_noqa, is_python_source_path, rule_path, run_guard


RULE_ID = "no-new-getattr"
RULE_PATH = rule_path("no_new_getattr.yml")
VIOLATION_MESSAGE = "no-new-getattr net-new getattr() in added code"


def is_reportable_match(match: Match) -> bool:
    return not has_reasoned_noqa(match.source_line, RULE_ID)


def main() -> int:
    return run_guard(
        description=__doc__,
        rule=RULE_PATH,
        is_scanned_path=is_python_source_path,
        is_reportable_match=is_reportable_match,
        violation_message=VIOLATION_MESSAGE,
    )


if __name__ == "__main__":
    raise SystemExit(main())
