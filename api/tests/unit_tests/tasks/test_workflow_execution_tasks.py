from datetime import UTC, datetime, timedelta

from graphon.entities import WorkflowExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models import CreatorUserRole, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom
from tasks.workflow_execution_tasks import (
    _calculate_elapsed_time,
    _create_workflow_run_from_execution,
    _update_workflow_run_from_execution,
)


def _execution(
    *,
    elapsed_time: float = 3.5,
    exceptions_count: int = 2,
    finished_at: datetime | None = None,
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
        status=WorkflowExecutionStatus.SUCCEEDED,
        error_message="",
        elapsed_time=elapsed_time,
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


def test_calculate_elapsed_time_uses_runtime_elapsed_time_until_finished() -> None:
    execution = _execution(finished_at=None)
    execution.started_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=4)

    elapsed_time = _calculate_elapsed_time(execution)

    assert 3.9 <= elapsed_time <= 5.0


def test_calculate_elapsed_time_clamps_negative_duration_to_zero() -> None:
    execution = _execution(finished_at=datetime(2026, 1, 1, 11, 59, 59))

    assert _calculate_elapsed_time(execution) == 0.0
