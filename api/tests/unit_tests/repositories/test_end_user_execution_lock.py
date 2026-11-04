"""Dialect compatibility and precise translation of nonblocking identity-lock failures."""

import pytest
import sqlalchemy as sa
from psycopg2.errors import LockNotAvailable
from pymysql.err import OperationalError as MySQLError
from sqlalchemy import event
from sqlalchemy.dialects import mysql, postgresql
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import ORMExecuteState, Session

from models.enums import EndUserType
from models.model import EndUser
from repositories.end_user_execution_lock import lock_end_user, translate_end_user_lock_errors
from repositories.entities.web_execution import EndUserBusyError


@pytest.mark.parametrize("backend", ["postgresql", "mysql8"])
@pytest.mark.parametrize("exclusive", [False, True])
def test_identity_lock_is_scoped_and_compiles_to_nowait_shared_or_exclusive(
    sqlite_session: Session, backend: str, exclusive: bool
) -> None:
    user = EndUser(tenant_id="tenant", app_id="app", type=EndUserType.BROWSER, session_id="browser")
    sqlite_session.add(user)
    sqlite_session.commit()
    dialect = postgresql.dialect() if backend == "postgresql" else mysql.dialect()
    if isinstance(dialect, mysql.dialect):
        dialect.use_mysql_for_share = True
    statements: list[str] = []

    def record(state: ORMExecuteState) -> None:
        if isinstance(state.statement, sa.sql.Select):
            statements.append(str(state.statement.compile(dialect=dialect)))

    event.listen(sqlite_session, "do_orm_execute", record)
    try:
        found = lock_end_user(
            sqlite_session, tenant_id="tenant", app_id="app", end_user_id=user.id, exclusive=exclusive
        )
    finally:
        event.remove(sqlite_session, "do_orm_execute", record)
    assert found is not None
    assert found.id == user.id
    assert statements[-1].endswith("FOR UPDATE NOWAIT" if exclusive else "FOR SHARE NOWAIT")
    assert "end_users.tenant_id =" in statements[-1]
    assert "end_users.app_id =" in statements[-1]


@pytest.mark.parametrize("driver_error", [LockNotAvailable("busy"), MySQLError(3572, "busy")])
def test_only_known_nowait_conflicts_become_retryable_identity_errors(driver_error: Exception) -> None:
    with pytest.raises(EndUserBusyError), translate_end_user_lock_errors():
        raise OperationalError("SELECT", {}, driver_error)


def test_unexpected_database_failure_is_not_reported_as_identity_contention() -> None:
    original = OperationalError("SELECT", {}, MySQLError(1064, "invalid SQL"))
    with pytest.raises(OperationalError) as caught, translate_end_user_lock_errors():
        raise original
    assert caught.value is original
