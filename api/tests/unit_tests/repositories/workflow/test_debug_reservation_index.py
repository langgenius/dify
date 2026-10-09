"""Expiry uses the lease index, independently of the number of historical graphs."""

from collections.abc import Mapping, Sequence
from datetime import timedelta
from uuid import UUID

from sqlalchemy import Engine, Table, event
from sqlalchemy.engine import Connection, ExecutionContext
from sqlalchemy.engine.interfaces import DBAPICursor
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowDebugReservation, WorkflowRun, WorkflowType
from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository

type DriverParameters = Mapping[str, object] | Sequence[object] | None


def test_due_scan_uses_covering_range_index_with_large_run_history(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> None:
    now = naive_utc_now()
    ids = [str(UUID(int=i + 1)) for i in range(10_004)]
    workflow_run_table = WorkflowRun.__table__
    assert isinstance(workflow_run_table, Table)
    with sqlite_session_factory.begin() as session:
        session.execute(
            workflow_run_table.insert(),
            [
                {
                    "id": execution_id,
                    "tenant_id": "tenant",
                    "app_id": "app",
                    "workflow_id": "workflow",
                    "type": WorkflowType.WORKFLOW,
                    "triggered_from": WorkflowRunTriggeredFrom.DEBUGGING,
                    "version": "draft",
                    "graph": '{"nodes":[],"edges":[]}',
                    "status": WorkflowExecutionStatus.SUCCEEDED,
                    "created_by_role": CreatorUserRole.ACCOUNT,
                    "created_by": "actor",
                }
                for execution_id in ids
            ],
        )
        session.add_all(
            [
                WorkflowDebugReservation(workflow_run_id=ids[-4], expires_at=now - timedelta(seconds=2)),
                WorkflowDebugReservation(workflow_run_id=ids[-3], expires_at=now - timedelta(seconds=1)),
                WorkflowDebugReservation(workflow_run_id=ids[-2], expires_at=now + timedelta(days=1)),
                WorkflowDebugReservation(workflow_run_id=ids[-1], expires_at=None, started_at=now),
            ]
        )
    queries: list[tuple[str, DriverParameters]] = []

    def record_query(
        _connection: Connection,
        _cursor: DBAPICursor,
        statement: str,
        parameters: DriverParameters,
        _context: ExecutionContext | None,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            queries.append((statement, parameters))

    repository = WorkflowDebugReservationRepository(sqlite_session_factory)
    event.listen(sqlite_engine, "before_cursor_execute", record_query)
    try:
        first = repository.pending_batch(now, limit=1)
        second = repository.pending_batch(now, limit=1, after=first[0])
        assert [cursor.execution_id for cursor in first + second] == ids[-4:-2]
        assert repository.pending_batch(now, limit=1, after=second[0]) == []
        assert repository.pending_batch(now - timedelta(days=1), limit=100) == []
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_query)

    assert len(queries) == 4
    with sqlite_engine.connect() as connection:
        for statement, parameters in queries:
            assert "workflow_runs" not in statement
            assert "graph" not in statement
            plan = connection.exec_driver_sql("EXPLAIN QUERY PLAN " + statement, parameters).all()
            description = " ".join(str(row[-1]) for row in plan)
            assert (
                "SEARCH workflow_debug_reservations USING COVERING INDEX workflow_debug_reservation_due_idx"
                in description
            )
            assert "expires_at" in description
            assert "SCAN" not in description
            assert "TEMP B-TREE" not in description
