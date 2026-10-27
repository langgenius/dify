"""Record the order in which OAuth writes lock tables.

SQLite ignores ``FOR UPDATE``, so the recorder compiles each ORM statement for
PostgreSQL and keeps the table of every locking read, UPDATE and DELETE.
INSERTs flushed by the unit of work are not seen.
"""

import re
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field

from sqlalchemy import event
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.sql import ClauseElement

# Every path takes the account row first, then access rows, then refresh rows.
LOCK_ORDER = ("accounts", "oauth_access_tokens", "oauth_refresh_tokens")

_TARGET_TABLE = re.compile(r"\b(?:FROM|UPDATE)\s+(\w+)")


@dataclass
class LockLog:
    tables: list[str] = field(default_factory=list)
    # ``len(tables)`` at each commit, so a test can tell which transaction did what.
    commits: list[int] = field(default_factory=list)

    def follows_lock_order(self) -> bool:
        ranks = [LOCK_ORDER.index(table) for table in self.tables]
        return ranks == sorted(ranks)


@contextmanager
def record_locks(factory: sessionmaker[Session]) -> Generator[LockLog]:
    log = LockLog()

    def on_execute(state: ORMExecuteState) -> None:
        if not isinstance(state.statement, ClauseElement):
            return
        sql = str(state.statement.compile(dialect=postgresql.dialect()))
        if state.is_select and "FOR UPDATE" not in sql:
            return
        match = _TARGET_TABLE.search(sql)
        if match is not None:
            log.tables.append(match.group(1))

    def on_commit(session: Session) -> None:
        _ = session
        log.commits.append(len(log.tables))

    event.listen(factory, "do_orm_execute", on_execute)
    event.listen(factory, "after_commit", on_commit)
    try:
        yield log
    finally:
        event.remove(factory, "do_orm_execute", on_execute)
        event.remove(factory, "after_commit", on_commit)
