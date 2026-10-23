"""SQL emitted by terminal recovery must preserve ownership across DB dialects."""

import pytest
from sqlalchemy import Select, event
from sqlalchemy.dialects import mysql, postgresql
from sqlalchemy.engine.interfaces import Dialect
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.sql.base import Executable

from services.dify_builder.native_testing.confirmed_agent_completion import reconcile_completed_builder_runs


@pytest.mark.parametrize(
    ("dialect", "comparison"),
    [
        (
            postgresql.dialect(),
            "dify_builder_runs.inputs_ref = CAST(dify_builder_execution_requests.test_input_id AS VARCHAR)",
        ),
        (
            mysql.dialect(),
            "dify_builder_runs.inputs_ref = CAST(dify_builder_execution_requests.test_input_id AS CHAR)",
        ),
    ],
    ids=["postgresql", "mysql"],
)
def test_terminal_scan_compares_input_ids_as_strings(
    dialect: Dialect, comparison: str, sqlite_session_factory: sessionmaker[Session]
) -> None:
    # Execute the production scan on the pristine real SQLite schema and observe
    # its actual ORM statement; no query or database behavior is replaced.
    statements: list[Executable] = []

    def capture(state: ORMExecuteState) -> None:
        statements.append(state.statement)

    event.listen(sqlite_session_factory, "do_orm_execute", capture)
    try:
        assert reconcile_completed_builder_runs(sessions=sqlite_session_factory, limit=7) == 0
    finally:
        event.remove(sqlite_session_factory, "do_orm_execute", capture)

    assert len(statements) == 1
    statement = statements[0]
    assert isinstance(statement, Select)
    query = str(statement.compile(dialect=dialect, compile_kwargs={"literal_binds": True}))
    assert comparison in query
    assert "dify_builder_runs.session_id = dify_builder_execution_requests.session_id" in query
    assert "dify_builder_runs.kind = 'verify'" in query
    assert "dify_builder_runs.status = 'running'" in query
    assert "dify_builder_execution_requests.state = 'sealed'" in query
    assert "builder-agent-confirmed-v1" in query
    assert "ORDER BY dify_builder_execution_requests.created_at" in query
    assert "LIMIT 7" in query
