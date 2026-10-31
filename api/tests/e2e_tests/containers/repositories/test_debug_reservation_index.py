"""PostgreSQL verifies the expiry range plan against unrelated run and lease history."""

from collections.abc import Mapping, Sequence
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import Engine, Table, delete, event
from sqlalchemy.engine import Connection, ExecutionContext
from sqlalchemy.engine.interfaces import DBAPICursor
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowDebugReservation, WorkflowRun, WorkflowType
from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository

type DriverParameters = Mapping[str, object] | Sequence[object] | None


def test_postgresql_expiry_plan_uses_due_index(db_session_with_containers: Session) -> None:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    if engine.dialect.name != "postgresql":
        pytest.skip("This query-plan assertion is specific to PostgreSQL")
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    now = naive_utc_now()
    tenant_id, app_id, workflow_id, actor_id = (str(uuid4()) for _ in range(4))
    ids = [str(uuid4()) for _ in range(20_002)]
    queries: list[tuple[str, DriverParameters]] = []

    def capture(
        _connection: Connection,
        _cursor: DBAPICursor,
        statement: str,
        parameters: DriverParameters,
        _context: ExecutionContext | None,
        _executemany: bool,
    ) -> None:
        if statement.startswith("SELECT"):
            queries.append((statement, parameters))

    workflow_run_table = WorkflowRun.__table__
    debug_reservation_table = WorkflowDebugReservation.__table__
    assert isinstance(workflow_run_table, Table)
    assert isinstance(debug_reservation_table, Table)
    try:
        with sessions.begin() as session:
            session.execute(
                workflow_run_table.insert(),
                [
                    {
                        "id": run_id,
                        "tenant_id": tenant_id,
                        "app_id": app_id,
                        "workflow_id": workflow_id,
                        "type": WorkflowType.WORKFLOW,
                        "triggered_from": WorkflowRunTriggeredFrom.DEBUGGING,
                        "version": "draft",
                        "graph": '{"nodes":[],"edges":[]}',
                        "status": WorkflowExecutionStatus.RUNNING,
                        "created_by_role": CreatorUserRole.ACCOUNT,
                        "created_by": actor_id,
                    }
                    for run_id in ids
                ],
            )
            session.execute(
                debug_reservation_table.insert(),
                [
                    {
                        "workflow_run_id": run_id,
                        "expires_at": now + timedelta(days=1),
                    }
                    for run_id in ids[10_000:-2]
                ]
                + [
                    {
                        "workflow_run_id": run_id,
                        "expires_at": now - timedelta(seconds=1),
                    }
                    for run_id in ids[-2:]
                ],
            )
        with engine.begin() as connection:
            connection.exec_driver_sql("ANALYZE workflow_debug_reservations")
        event.listen(engine, "before_cursor_execute", capture)
        try:
            repository = WorkflowDebugReservationRepository(sessions)
            due = repository.pending_batch(now, limit=100)
            # Existing test data may also be due; verify our records and index on both cursor paths.
            assert set(ids[-2:]) <= {row.execution_id for row in due}
            repository.pending_batch(now, limit=100, after=due[-1])
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        assert len(queries) == 2
        with engine.connect() as connection:
            for statement, parameters in queries:
                assert "workflow_runs" not in statement
                assert "graph" not in statement
                plan = connection.exec_driver_sql("EXPLAIN (FORMAT JSON) " + statement, parameters).scalar_one()[0][
                    "Plan"
                ]
                while plan.get("Plans"):
                    plan = plan["Plans"][0]
                assert plan["Node Type"] in {"Index Scan", "Index Only Scan"}
                assert plan["Index Name"] == "workflow_debug_reservation_due_idx"
                assert "expires_at" in plan["Index Cond"]
    finally:
        with sessions.begin() as session:
            session.execute(delete(WorkflowDebugReservation).where(WorkflowDebugReservation.workflow_run_id.in_(ids)))
            session.execute(delete(WorkflowRun).where(WorkflowRun.tenant_id == tenant_id))
