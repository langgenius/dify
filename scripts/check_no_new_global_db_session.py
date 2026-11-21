#!/usr/bin/env python3
"""Block net-new uses of the global `db.session` outside controllers.

`db.session` is the request-scoped session: once it has run a statement it
keeps a pooled connection until someone commits, rolls back or removes it.
Code under `core`, `services`, `tasks` and the other runtime packages also
runs in worker threads, generators and Celery tasks, where nothing ends that
transaction for it, so the connection stays out while the code waits on a
model, a vector store or another thread. Enough of those at once empty the
pool and every request in the process stalls.

New code there should take a session as an argument or open a short one
with `session_factory.create_session()`, and close it before it waits on
anything outside the database. `models/engine.py` already asks for this;
this guard keeps the count from growing while existing uses are removed.

Scanned: Python sources under `api/`, except `api/controllers` (request
scope, covered by the controller SQLAlchemy guard), `api/commands` (one-off
CLI commands), `api/migrations`, `api/dev` and `api/tests`. Pre-existing
matches are ignored via the shared baseline diff (`scripts/ast_grep_guard.py`).

A `# guard-ignore: no-new-global-db-session -- <reason>` comment on the same
source line suppresses a violation with a human-readable reason.
"""

from __future__ import annotations

from pathlib import Path

from ast_grep_guard import Match, has_reasoned_guard_ignore, is_python_source_path, rule_path, run_guard


RULE_ID = "no-new-global-db-session"
RULE_PATH = rule_path("no_new_global_db_session.yml")
API_ROOT = Path("api")
EXEMPT_ROOTS = tuple(API_ROOT / name for name in ("controllers", "commands", "migrations", "dev", "tests"))
VIOLATION_MESSAGE = (
    "no-new-global-db-session net-new db.session outside controllers; "
    "pass a session in or use session_factory.create_session() and close it before waiting on a model or service"
)


def is_guarded_source_path(path: str) -> bool:
    if not is_python_source_path(path):
        return False
    source_path = Path(path)
    if not source_path.is_relative_to(API_ROOT):
        return False
    return not any(source_path.is_relative_to(root) for root in EXEMPT_ROOTS)


def is_reportable_match(match: Match) -> bool:
    return not has_reasoned_guard_ignore(match.source_line, RULE_ID)


def main() -> int:
    return run_guard(
        description=__doc__,
        rule=RULE_PATH,
        is_scanned_path=is_guarded_source_path,
        is_reportable_match=is_reportable_match,
        violation_message=VIOLATION_MESSAGE,
    )


if __name__ == "__main__":
    raise SystemExit(main())
