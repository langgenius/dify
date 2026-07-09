from datetime import datetime
from unittest.mock import Mock, patch

from graphon.entities import WorkflowExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models import CreatorUserRole, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom
from tasks.workflow_execution_tasks import (
    _calculate_elapsed_time,
    _create_workflow_run_from_execution,
    _update_workflow_run_from_execution,
    save_workflow_execution_task,
)


def _execution(
    *,
    exceptions_count: int = 2,
    finished_at: datetime | None = None,
    status: WorkflowExecutionStatus = WorkflowExecutionStatus.SUCCEEDED,
) -> WorkflowExecution:
    started_at = datetime(2026, 1, 1, 12, 0, 0)
    return WorkflowExecution(
        id_="workflow-run-id",
        workflow_id="workflow-id",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="1.0",
        graph={"nodes": [], "edges": []},
        inputs={"input": "value"},
        outputs={"output": "value"},
        status=status,
        error_message="",
        total_tokens=100,
        total_steps=5,
        exceptions_count=exceptions_count,
        started_at=started_at,
        finished_at=finished_at,
    )


def test_create_workflow_run_calculates_elapsed_time_and_exceptions_count() -> None:
    execution = _execution(finished_at=datetime(2026, 1, 1, 12, 0, 12), exceptions_count=3)

    workflow_run = _create_workflow_run_from_execution(
        execution=execution,
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        creator_user_id="user-id",
        creator_user_role=CreatorUserRole.ACCOUNT,
    )

    assert workflow_run.elapsed_time == 12.0
    assert workflow_run.exceptions_count == 3


def test_update_workflow_run_calculates_elapsed_time_and_exceptions_count() -> None:
    workflow_run = WorkflowRun()
    execution = _execution(finished_at=datetime(2026, 1, 1, 12, 0, 8), exceptions_count=4)

    _update_workflow_run_from_execution(workflow_run, execution)

    assert workflow_run.elapsed_time == 8.0
    assert workflow_run.exceptions_count == 4


def test_calculate_elapsed_time_is_zero_until_finished() -> None:
    assert _calculate_elapsed_time(_execution(finished_at=None)) == 0.0


def test_calculate_elapsed_time_clamps_negative_duration_to_zero() -> None:
    execution = _execution(finished_at=datetime(2026, 1, 1, 11, 59, 59))

    assert _calculate_elapsed_time(execution) == 0.0


@patch("tasks.workflow_execution_tasks.session_factory.create_session")
def test_save_workflow_execution_task_ignores_stale_nonterminal_snapshot(mock_create_session: Mock) -> None:
    existing_run = WorkflowRun()
    existing_run.status = WorkflowExecutionStatus.SUCCEEDED
    existing_run.finished_at = datetime(2026, 1, 1, 12, 0, 10)
    session = _TaskSession(existing_run)
    mock_create_session.return_value = session
    execution = _execution(finished_at=None, status=WorkflowExecutionStatus.RUNNING)

    result = save_workflow_execution_task.run(
        execution_data=execution.model_dump(),
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN.value,
        creator_user_id="user-id",
        creator_user_role=CreatorUserRole.ACCOUNT.value,
    )

    assert result is True
    assert session.committed is False
    assert existing_run.status == WorkflowExecutionStatus.SUCCEEDED


class _TaskSession:
    def __init__(self, existing_run: WorkflowRun) -> None:
        self._existing_run = existing_run
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def scalar(self, _stmt):
        return self._existing_run

    def commit(self) -> None:
        self.committed = True
