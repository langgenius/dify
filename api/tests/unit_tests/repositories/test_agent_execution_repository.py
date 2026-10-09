"""Execution retention uses candidate-indexed references rather than graph scans."""

from datetime import timedelta
from functools import partial

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.agent import WorkflowAgentNodeBinding
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowRun, WorkflowType
from repositories.agent.runtime_repository import WorkflowAgentExecutionRepository
from repositories.workflow.execution_write_repository import WorkflowExecutionWriteRepository
from tests.unit_tests.workflow_execution import debug_lease, execution_binding, set_debug_deadline


def _run(run_id: str, status: WorkflowExecutionStatus) -> WorkflowRun:
    return WorkflowRun(
        id=run_id,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="draft",
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        graph='{"note": "Retention must not select or decode this graph"}',
    )


def _reference(run_id: str, agent_id: str) -> WorkflowAgentNodeBinding:
    return execution_binding(workflow_run_id=run_id, tenant_id="tenant-1", app_id="app-1", agent_id=agent_id)


def test_retention_queries_candidates_through_agent_index(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        for i in range(100):
            run_id = f"unrelated-{i}"
            session.add(_run(run_id, WorkflowExecutionStatus.RUNNING))
            session.flush()
            session.add(_reference(run_id, f"other-agent-{i}"))
        for run_id, status in (
            ("running", WorkflowExecutionStatus.RUNNING),
            ("paused", WorkflowExecutionStatus.PAUSED),
            ("ended", WorkflowExecutionStatus.STOPPED),
        ):
            session.add(_run(run_id, status))
            session.flush()
            session.add(_reference(run_id, f"agent-{run_id}"))
    statements: list[tuple[str, tuple[object, ...]]] = []
    engine = sqlite_session_factory.kw["bind"]

    def record(_conn: object, _cursor: object, sql: str, parameters: tuple[object, ...], *_args: object) -> None:
        statements.append((sql, parameters))

    event.listen(engine, "before_cursor_execute", record)
    try:
        with sqlite_session_factory() as session:
            assert WorkflowAgentExecutionRepository.retained_execution_agent_ids(
                session, "tenant-1", ["agent-running", "agent-paused", "agent-ended"]
            ) == {"agent-running", "agent-paused"}
            assert not session.identity_map  # No WorkflowRun graph or ORM rows were materialized.
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert len(statements) == 1
    sql, parameters = statements[0]
    assert "graph" not in sql
    with engine.connect() as connection:
        plan = connection.exec_driver_sql("EXPLAIN QUERY PLAN " + sql, parameters).all()
    assert any("SEARCH" in row[3] and "workflow_agent_node_binding_agent_idx" in row[3] for row in plan)


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "workflow_id"])
def test_retention_requires_complete_owner_chain(sqlite_session_factory: sessionmaker[Session], field: str) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_run("run", WorkflowExecutionStatus.PAUSED))
        session.flush()
        reference = _reference("run", "agent-1")
        setattr(reference, field, "other-owner")
        session.add(reference)
    with sqlite_session_factory() as session:
        assert WorkflowAgentExecutionRepository.retained_execution_agent_ids(session, "tenant-1", ["agent-1"]) == set()


@pytest.mark.parametrize("cancel", [False, True])
def test_execution_finish_keeps_retry_candidates_including_cancelled_reservation(
    sqlite_session_factory: sessionmaker[Session], cancel: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_run("run", WorkflowExecutionStatus.RUNNING if cancel else WorkflowExecutionStatus.PAUSED))
        session.flush()
        if cancel:
            set_debug_deadline(session, "run", naive_utc_now() + timedelta(minutes=1))
        session.add(_reference("run", "agent-1"))
    repository = WorkflowAgentExecutionRepository(sqlite_session_factory)
    finish = partial(
        WorkflowExecutionWriteRepository(sqlite_session_factory).finish,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        execution_id="run",
    )
    if not cancel:
        assert finish() == WorkflowExecutionStatus.PAUSED
        assert (
            repository.finished_agent_ids(
                tenant_id="tenant-1", app_id="app-1", workflow_id="workflow-1", execution_id="run"
            )
            == set()
        )
    assert finish(status=WorkflowExecutionStatus.STOPPED, cancel=cancel) == WorkflowExecutionStatus.STOPPED
    with sqlite_session_factory() as session:
        assert WorkflowAgentExecutionRepository.retained_execution_agent_ids(session, "tenant-1", ["agent-1"]) == set()
        assert session.scalar(select(WorkflowAgentNodeBinding)) is not None
        run = session.get(WorkflowRun, "run")
        assert run is not None
        assert run.status == WorkflowExecutionStatus.STOPPED
        if cancel:
            reservation = debug_lease(session, "run")
            assert reservation is not None
            assert reservation.expires_at is not None
            assert reservation.expires_at <= naive_utc_now()
    assert finish(cancel=cancel) == WorkflowExecutionStatus.STOPPED
    assert repository.finished_agent_ids(
        tenant_id="tenant-1", app_id="app-1", workflow_id="workflow-1", execution_id="run"
    ) == {"agent-1"}


def test_execution_pins_are_not_reported_as_editable_workflow_nodes(sqlite_session: Session) -> None:
    from services.agent.composer_service import AgentComposerService

    pin = _reference("run", "agent-1")
    pin.current_snapshot_id = "snapshot-1"
    draft = _reference("workflow-1", "agent-1")
    draft.workflow_version = "draft"
    draft.current_snapshot_id = "snapshot-1"
    sqlite_session.add_all([pin, draft])
    sqlite_session.commit()

    impact = AgentComposerService.calculate_impact(
        session=sqlite_session, tenant_id="tenant-1", current_snapshot_id="snapshot-1"
    )
    assert impact["workflow_node_count"] == 1
    assert impact["bindings"] == [{"app_id": "app-1", "workflow_id": "workflow-1", "node_id": "agent-1"}]
