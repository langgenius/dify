from datetime import datetime

import pytest
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowPause, WorkflowRun, WorkflowType
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository


@pytest.mark.parametrize("mismatch", [None, "tenant", "app", "pause", "running", "resumed"])
def test_failure_only_transitions_the_owned_active_pause(
    sqlite_session_factory: sessionmaker[Session], mismatch: str | None
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            WorkflowRun(
                id="run",
                tenant_id="tenant",
                app_id="app",
                workflow_id="workflow",
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="published",
                graph="{}",
                inputs="{}",
                status=WorkflowExecutionStatus.RUNNING if mismatch == "running" else WorkflowExecutionStatus.PAUSED,
                created_by_role=CreatorUserRole.END_USER,
                created_by="user",
                elapsed_time=3.0,
                total_tokens=10,
                total_steps=2,
            )
        )
        pause = WorkflowPause(
            workflow_id="workflow",
            workflow_run_id="run",
            state_object_key="state",
            resumed_at=datetime(2026, 1, 1) if mismatch == "resumed" else None,
        )
        pause.id = "pause"
        session.add(pause)
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    result = repository.fail_workflow_pause(
        tenant_id="foreign" if mismatch == "tenant" else "tenant",
        app_id="foreign" if mismatch == "app" else "app",
        workflow_run_id="run",
        pause_id="foreign" if mismatch == "pause" else "pause",
        error="Rejected",
    )
    if mismatch is not None:
        assert result is None
        with sqlite_session_factory() as session:
            run = session.get(WorkflowRun, "run")
            assert run is not None
            assert run.finished_at is None
            assert run.error is None
        return
    assert result is not None
    assert result.status == WorkflowExecutionStatus.FAILED
    assert result.finished_at is not None
    assert result.elapsed_time == 3.0
    assert result.total_tokens == 10
    assert result.total_steps == 2
    assert (
        repository.fail_workflow_pause(
            tenant_id="tenant",
            app_id="app",
            workflow_run_id="run",
            pause_id="pause",
            error="Retry",
        )
        is None
    )
