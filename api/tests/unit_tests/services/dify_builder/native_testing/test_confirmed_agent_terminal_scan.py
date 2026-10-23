"""SQL emitted by terminal recovery must preserve ownership across DB dialects."""

from unittest.mock import MagicMock

import pytest
from sqlalchemy.dialects import mysql, postgresql
from sqlalchemy.engine.interfaces import Dialect

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
def test_terminal_scan_compares_input_ids_as_strings(dialect: Dialect, comparison: str) -> None:
    # Capture the actual production query at its SQL boundary without replacing
    # SQLAlchemy's dialect compilation or constructing another copy of the join.
    sessions = MagicMock()
    sql = sessions.return_value.__enter__.return_value
    sql.scalars.return_value.all.return_value = []

    assert reconcile_completed_builder_runs(sessions=sessions, limit=7) == 0

    statement = sql.scalars.call_args.args[0]
    query = str(statement.compile(dialect=dialect, compile_kwargs={"literal_binds": True}))
    assert comparison in query
    assert "dify_builder_runs.session_id = dify_builder_execution_requests.session_id" in query
    assert "dify_builder_runs.kind = 'verify'" in query
    assert "dify_builder_runs.status = 'running'" in query
    assert "dify_builder_execution_requests.state = 'sealed'" in query
    assert "builder-agent-confirmed-v1" in query
    assert "ORDER BY dify_builder_execution_requests.created_at" in query
    assert "LIMIT 7" in query
