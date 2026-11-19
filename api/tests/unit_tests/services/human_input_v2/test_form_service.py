from datetime import timedelta

import pytest

from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input_v2.entities import Initiator
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from libs.datetime_utils import naive_utc_now
from models import Account
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input_v2 import HumanInputForm
from models.workflow import WorkflowPause, WorkflowRun
from repositories.entities.workflow_execution import WorkflowExecution
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    WorkflowRunNotPausedError,
)
from tasks.workflow_execution_tasks import save_workflow_execution_task
from tests.helpers.unit.services.human_input_v2.form_runtime import (
    ACCOUNT_ID,
    APP_ID,
    TENANT_ID,
    WORKFLOW_RUN_ID,
    FormRuntimeContext,
    make_form_node,
)


@pytest.mark.parametrize("initial_status", [WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED])
@pytest.mark.parametrize("late_status", [WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED])
@pytest.mark.parametrize("history_backend", ["sql", "celery"])
def test_global_timeout_cannot_be_overwritten_by_late_history(
    context: FormRuntimeContext,
    initial_status: WorkflowExecutionStatus,
    late_status: WorkflowExecutionStatus,
    history_backend: str,
) -> None:
    """Given active execution history, timeout must survive a later stale save."""
    form = context.prepare(make_form_node(Initiator())).form
    with context.sessions.begin() as session:
        run = session.get_one(WorkflowRun, WORKFLOW_RUN_ID)
        run.status = initial_status
        session.get_one(HumanInputForm, form.id).global_timeout_deadline = naive_utc_now() - timedelta(seconds=1)
        pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="checkpoint")
        session.add(pause)
        execution = WorkflowExecution(
            id_=run.id,
            workflow_id=run.workflow_id,
            workflow_type=WorkflowType.WORKFLOW,
            workflow_version=run.version,
            graph={},
            inputs={},
            started_at=run.created_at,
            status=late_status,
            finished_at=None,
            error_message="",
        )
        account = session.get_one(Account, ACCOUNT_ID)

    control = DifyAPISQLAlchemyWorkflowRunRepository(context.sessions)
    original_pause = control.get_workflow_pause(WORKFLOW_RUN_ID)
    assert original_pause is not None

    context.handle_timeouts()

    with context.sessions() as session:
        stopped = session.get_one(WorkflowRun, WORKFLOW_RUN_ID)
        assert stopped.status == WorkflowExecutionStatus.STOPPED
        assert stopped.error == "Human input global timeout"
        assert stopped.finished_at is not None
        finished_at = stopped.finished_at
        assert session.get_one(HumanInputForm, form.id).status == HumanInputFormStatus.EXPIRED
        assert session.get_one(WorkflowPause, pause.id).resumed_at == finished_at

    if history_backend == "sql":
        history = SQLAlchemyWorkflowExecutionRepository(
            session_factory=context.sessions,
            tenant_id=TENANT_ID,
            user=account,
            app_id=APP_ID,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )
        history.save(execution)
    else:
        assert save_workflow_execution_task(
            execution_data=execution.model_dump(mode="json"),
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            creator_user_id=ACCOUNT_ID,
            creator_user_role=CreatorUserRole.ACCOUNT,
        )

    with context.sessions() as session:
        stored = session.get_one(WorkflowRun, WORKFLOW_RUN_ID)
        assert stored.status == WorkflowExecutionStatus.STOPPED
        assert stored.error == "Human input global timeout"
        assert stored.finished_at == finished_at
        assert stored.stop_requested_at is not None

    resumed: list[None] = []
    with pytest.raises(WorkflowRunNotPausedError):
        control.resume_workflow_pause(WORKFLOW_RUN_ID, original_pause, before_resume=lambda: resumed.append(None))
    assert resumed == []
