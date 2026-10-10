"""Keep delayed execution history consistent with durable workflow cancellation."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from libs.datetime_utils import ensure_naive_utc
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun


def get_stopped_workflow_run(
    session: Session, *, tenant_id: str, workflow_run_id: str | None, lock: bool = False
) -> WorkflowRun | None:
    if workflow_run_id is None:
        return None
    statement = select(WorkflowRun).where(WorkflowRun.tenant_id == tenant_id, WorkflowRun.id == workflow_run_id)
    if lock:
        statement = statement.with_for_update()
    run = session.scalar(statement)
    if run is not None and run.status == WorkflowExecutionStatus.STOPPED and run.stop_requested_at is not None:
        return run
    return None


def apply_workflow_stop_to_node(
    execution: WorkflowNodeExecution | WorkflowNodeExecutionModel, stopped_run: WorkflowRun | None
) -> None:
    if stopped_run is None or execution.status not in (
        WorkflowNodeExecutionStatus.RUNNING,
        WorkflowNodeExecutionStatus.PAUSED,
    ):
        return
    execution.status = WorkflowNodeExecutionStatus.FAILED
    execution.error = stopped_run.error or "User requested stop"
    execution.finished_at = stopped_run.finished_at
    if stopped_run.finished_at is not None:
        execution.elapsed_time = max(
            (stopped_run.finished_at - ensure_naive_utc(execution.created_at)).total_seconds(), 0.0
        )
