#!/usr/bin/env python3
"""Block net-new session mock assignments in unit tests.

This catches net-new top-level session mocks like
`session = MagicMock()` or `db_session = Mock()` added to
`tests/unit_tests/**`. Pre-existing matches are ignored via the
shared baseline diff (`scripts/ast_grep_guard.py`), so historical
mocks that haven't been cleaned up yet do not block the gate.

A `# guard-ignore: no-new-session-mock -- <reason>` line on the same
source line suppresses a violation with a human-readable reason.
"""

from __future__ import annotations

from pathlib import Path

from ast_grep_guard import Match, has_reasoned_guard_ignore, is_python_source_path, rule_path, run_guard


RULE_ID = "no-new-session-mock"
RULE_PATH = rule_path("no_new_session_mock.yml")
TEST_ROOT = Path("api/tests/unit_tests")
VIOLATION_MESSAGE = "no-new-session-mock net-new session mock assignment in test code"


def is_test_source_path(path: str) -> bool:
    if not is_python_source_path(path):
        return False
    return Path(path).is_relative_to(TEST_ROOT)


def is_reportable_match(match: Match) -> bool:
    return not has_reasoned_guard_ignore(match.source_line, RULE_ID)


def main() -> int:
    return run_guard(
        description=__doc__,
        rule=RULE_PATH,
        is_scanned_path=is_test_source_path,
        is_reportable_match=is_reportable_match,
        violation_message=VIOLATION_MESSAGE,
    )


if __name__ == "__main__":
    raise SystemExit(main())
