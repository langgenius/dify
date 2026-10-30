from datetime import UTC, datetime

import pytest
from sqlalchemy import Table
from sqlalchemy.orm import Session

from enums.creator import CreatorUserRole
from graphon.enums import WorkflowExecutionStatus
from models.enums import AppTriggerType, WorkflowRunTriggeredFrom, WorkflowTriggerStatus
from models.trigger import WorkflowTriggerLog
from models.workflow import WorkflowRun, WorkflowType
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository


@pytest.mark.parametrize(
    ("run_status", "trigger_status"),
    [
        (WorkflowExecutionStatus.SUCCEEDED, WorkflowTriggerStatus.SUCCEEDED),
        (WorkflowExecutionStatus.PARTIAL_SUCCEEDED, WorkflowTriggerStatus.SUCCEEDED),
        (WorkflowExecutionStatus.FAILED, WorkflowTriggerStatus.FAILED),
        (WorkflowExecutionStatus.STOPPED, WorkflowTriggerStatus.FAILED),
    ],
)
def test_terminal_result_repairs_old_paused_trigger_without_resume(
    sqlite_session: Session,
    run_status: WorkflowExecutionStatus,
    trigger_status: WorkflowTriggerStatus,
) -> None:
    workflow_run_table = WorkflowRun.__table__
    trigger_log_table = WorkflowTriggerLog.__table__
    assert isinstance(workflow_run_table, Table)
    assert isinstance(trigger_log_table, Table)
    WorkflowRun.metadata.create_all(
        sqlite_session.get_bind(),
        tables=[
            workflow_run_table,
            trigger_log_table,
        ],
    )
    finished = datetime.now(UTC).replace(tzinfo=None)
    run = WorkflowRun(
        id="run",
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        type=WorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=run_status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account",
        outputs='{"answer":"persisted"}',
        total_tokens=17,
        elapsed_time=12,
        finished_at=finished,
    )
    trigger = WorkflowTriggerLog(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        workflow_run_id=run.id,
        root_node_id=None,
        outputs=None,
        error=None,
        celery_task_id=None,
        trigger_metadata="{}",
        trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
        trigger_data="{}",
        inputs="{}",
        status=WorkflowTriggerStatus.PAUSED,
        queue_name="workflow",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account",
        retry_count=0,
    )
    sqlite_session.add_all([run, trigger])
    sqlite_session.commit()
    repository = SQLAlchemyWorkflowTriggerLogRepository(sqlite_session)
    for _ in range(2):
        assert repository.reconcile_published_run_result(run.id)
        sqlite_session.commit()
    sqlite_session.expire_all()
    stored = sqlite_session.get_one(WorkflowTriggerLog, trigger.id)
    assert stored.status == trigger_status
    assert stored.outputs == run.outputs
    assert stored.total_tokens == 17
    assert stored.finished_at == finished
    assert sqlite_session.get_one(WorkflowRun, run.id).status == run_status
