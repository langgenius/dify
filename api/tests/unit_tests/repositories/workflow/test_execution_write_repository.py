"""Both execution backends honor the same locked terminal-state boundary."""

from collections.abc import Callable
from datetime import timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy import Select, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

from core.repositories.celery_workflow_execution_repository import CeleryWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from graphon.entities import WorkflowExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from libs.datetime_utils import naive_utc_now
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowPause, WorkflowRun
from repositories.agent.runtime_repository import WorkflowAgentExecutionRepository
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
from repositories.workflow.execution_write_repository import (
    DebugLease,
    WorkflowExecutionWriteRepository,
    write_debug_lease,
)
from tasks import workflow_execution_tasks as storage
from tests.unit_tests.model_factories import make_account
from tests.unit_tests.workflow_execution import execution_binding


@pytest.fixture(params=["sqlalchemy", "celery"])
def write_execution(
    request: pytest.FixtureRequest, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Callable[[WorkflowExecution], None]:
    repository_type = (
        SQLAlchemyWorkflowExecutionRepository if request.param == "sqlalchemy" else CeleryWorkflowExecutionRepository
    )
    writer = repository_type(
        session_factory=sqlite_session_factory,
        tenant_id="tenant-1",
        app_id="app-1",
        user=make_account(),
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
    )
    queued = Mock()
    monkeypatch.setattr(storage.save_workflow_execution_task, "delay", queued)
    monkeypatch.setattr(storage.session_factory, "create_session", sqlite_session_factory)

    def retry(*, exc: Exception, countdown: int) -> None:
        assert countdown > 0
        raise exc

    monkeypatch.setattr(storage.save_workflow_execution_task, "retry", retry)

    def write(execution: WorkflowExecution) -> None:
        writer.save(execution)
        if request.param == "celery":
            storage.save_workflow_execution_task(**queued.call_args.kwargs)

    return write


def _execution() -> WorkflowExecution:
    return WorkflowExecution(
        id_="run-1",
        workflow_id="workflow-1",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="draft",
        graph={"nodes": [], "edges": []},
        inputs={},
        outputs={},
        status=WorkflowExecutionStatus.RUNNING,
        error_message="",
        total_tokens=0,
        total_steps=0,
        exceptions_count=0,
        started_at=naive_utc_now(),
        finished_at=None,
    )


@pytest.mark.parametrize(
    ("terminal", "late"),
    [
        (WorkflowExecutionStatus.FAILED, WorkflowExecutionStatus.RUNNING),
        (WorkflowExecutionStatus.FAILED, WorkflowExecutionStatus.PAUSED),
        (WorkflowExecutionStatus.FAILED, WorkflowExecutionStatus.SUCCEEDED),
        (WorkflowExecutionStatus.STOPPED, WorkflowExecutionStatus.RUNNING),
        (WorkflowExecutionStatus.SUCCEEDED, WorkflowExecutionStatus.RUNNING),
    ],
)
def test_delayed_write_cannot_revive_synchronously_finished_run(
    sqlite_session_factory: sessionmaker[Session],
    write_execution: Callable[[WorkflowExecution], None],
    terminal: WorkflowExecutionStatus,
    late: WorkflowExecutionStatus,
) -> None:
    started = _execution()
    write_execution(started)
    with sqlite_session_factory.begin() as session:
        session.add(
            execution_binding(
                workflow_run_id=started.id_,
                tenant_id="tenant-1",
                app_id="app-1",
                agent_id="agent-1",
            )
        )
    repository = WorkflowAgentExecutionRepository(sqlite_session_factory)
    assert (
        WorkflowExecutionWriteRepository(sqlite_session_factory).finish(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id=started.workflow_id,
            execution_id=started.id_,
            status=None if terminal == WorkflowExecutionStatus.FAILED else terminal,
        )
        == terminal
    )
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, started.id_)
        assert run is not None
        finished_at = run.finished_at
        error = run.error
    write_execution(started.model_copy(update={"status": late, "total_tokens": 999, "outputs": {"stale": True}}))
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, started.id_)
        assert run is not None
        assert run.status == terminal
        assert run.finished_at == finished_at
        assert run.error == error
        assert run.total_tokens == 0
        assert run.outputs_dict == {}
        assert repository.retained_execution_agent_ids(session, "tenant-1", ["agent-1"]) == set()


def test_resume_and_same_terminal_details_remain_writable(
    sqlite_session_factory: sessionmaker[Session],
    write_execution: Callable[[WorkflowExecution], None],
) -> None:
    execution = _execution()
    write_execution(execution.model_copy(update={"status": WorkflowExecutionStatus.PAUSED}))
    with sqlite_session_factory.begin() as session:
        session.add(
            WorkflowPause(workflow_id=execution.workflow_id, workflow_run_id=execution.id_, state_object_key="pause")
        )
    runs = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    pause = runs.get_workflow_pause(execution.id_)
    assert pause is not None
    runs.resume_workflow_pause(execution.id_, pause)
    write_execution(execution)
    finished = execution.model_copy(
        update={
            "status": WorkflowExecutionStatus.SUCCEEDED,
            "finished_at": execution.started_at + timedelta(seconds=1),
        }
    )
    write_execution(finished)
    write_execution(finished.model_copy(update={"outputs": {"answer": 42}, "total_tokens": 7, "exceptions_count": 2}))
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, execution.id_)
        assert run is not None
        assert run.status == WorkflowExecutionStatus.SUCCEEDED
        assert run.outputs_dict == {"answer": 42}
        assert run.total_tokens == 7
        assert run.exceptions_count == 2


def test_late_start_cannot_resume_paused_run_or_release_agents(
    sqlite_session_factory: sessionmaker[Session], write_execution: Callable[[WorkflowExecution], None]
) -> None:
    execution = _execution()
    write_execution(execution)
    now = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        run = session.get(WorkflowRun, execution.id_)
        assert run is not None
        write_debug_lease(
            session, run, DebugLease(expires_at=now - timedelta(seconds=1), started_at=now - timedelta(days=1))
        )
        session.add(
            execution_binding(
                workflow_run_id=execution.id_,
                tenant_id="tenant-1",
                app_id="app-1",
                agent_id="agent-1",
            )
        )
    write_execution(
        execution.model_copy(update={"status": WorkflowExecutionStatus.PAUSED, "outputs": {"waiting": True}})
    )
    # A retried startup task arrives after pause persistence, without a resume command.
    write_execution(execution)
    reservations = WorkflowDebugReservationRepository(sqlite_session_factory)
    assert reservations.pending_batch(now, limit=100) == []
    assert reservations.expire(execution.id_, now) is None
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, execution.id_)
        assert run is not None
        assert run.status == WorkflowExecutionStatus.PAUSED
        assert run.outputs_dict == {"waiting": True}
        assert WorkflowAgentExecutionRepository.retained_execution_agent_ids(session, "tenant-1", ["agent-1"]) == {
            "agent-1"
        }


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "workflow_id"])
def test_execution_write_rejects_wrong_owner(
    sqlite_session_factory: sessionmaker[Session],
    write_execution: Callable[[WorkflowExecution], None],
    field: str,
) -> None:
    execution = _execution()
    write_execution(execution)
    with sqlite_session_factory.begin() as session:
        run = session.get(WorkflowRun, execution.id_)
        assert run is not None
        setattr(run, field, "other-owner")
    with pytest.raises(ValueError, match="Unauthorized access"):
        write_execution(execution.model_copy(update={"status": WorkflowExecutionStatus.FAILED}))
    with sqlite_session_factory() as session:
        run = session.get(WorkflowRun, execution.id_)
        assert run is not None
        assert run.status == WorkflowExecutionStatus.RUNNING


def test_execution_writes_lock_the_owned_row(
    sqlite_session_factory: sessionmaker[Session],
    write_execution: Callable[[WorkflowExecution], None],
) -> None:
    execution = _execution()
    write_execution(execution)
    locks: list[str] = []

    def record(state: ORMExecuteState) -> None:
        if isinstance(state.statement, Select):
            sql = str(state.statement.compile(dialect=postgresql.dialect()))
            if "FOR UPDATE" in sql:
                locks.append(sql)

    event.listen(sqlite_session_factory, "do_orm_execute", record)
    try:
        write_execution(execution.model_copy(update={"status": WorkflowExecutionStatus.PAUSED}))
    finally:
        event.remove(sqlite_session_factory, "do_orm_execute", record)
    assert len(locks) == 1
    for column in ("id", "tenant_id", "app_id", "workflow_id"):
        assert f"workflow_runs.{column} =" in locks[0]
