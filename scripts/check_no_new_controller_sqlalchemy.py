#!/usr/bin/env python3
"""Block net-new direct SQLAlchemy calls in controller code.

Allowing flush() and commit() to allow controllers to control
the transaction border.
"""

from __future__ import annotations

import re
from pathlib import Path

from ast_grep_guard import Match, has_reasoned_noqa, rule_path, run_guard


RULE_ID = "no-new-controller-sqlalchemy"
RULE_PATH = rule_path("no_new_controller_sqlalchemy.yml")
CONTROLLER_ROOT = Path("api/controllers")
FLASK_SESSION_GET_PATTERN = re.compile(r"^session\.get\(\s*['\"]")
ALLOWED_SESSION_METHODS = frozenset({"commit", "flush"})
VIOLATION_MESSAGE = "no-new-controller-sqlalchemy net-new direct SQLAlchemy call in controller code"


def is_controller_python_source_path(path: str) -> bool:
    source_path = Path(path)
    return source_path.suffix in {".py", ".pyi"} and source_path.is_relative_to(CONTROLLER_ROOT)


def is_allowed_session_boundary(match: Match) -> bool:
    method = match.meta_variables.get("METHOD") or match.meta_variables.get("SESSION_METHOD")
    if method in ALLOWED_SESSION_METHODS:
        return True

    stripped_text = match.text.strip()
    return stripped_text.startswith(("db.session.commit(", "db.session.flush(", "session.commit(", "session.flush("))


def is_flask_session_get(match: Match) -> bool:
    return bool(FLASK_SESSION_GET_PATTERN.match(match.text.strip()))


def is_suppressed(match: Match) -> bool:
    return has_reasoned_noqa(match.source_line, RULE_ID)


def is_reportable_match(match: Match) -> bool:
    return (
        not is_allowed_session_boundary(match)
        and not is_flask_session_get(match)
        and not is_suppressed(match)
    )


def main() -> int:
    return run_guard(
        description=__doc__,
        rule=RULE_PATH,
        is_scanned_path=is_controller_python_source_path,
        is_reportable_match=is_reportable_match,
        violation_message=VIOLATION_MESSAGE,
    )


if __name__ == "__main__":
    raise SystemExit(main())
