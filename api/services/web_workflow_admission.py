"""Web-only launch admission; no identity locks are held while a worker executes."""

from collections.abc import Generator
from contextlib import contextmanager

from configs import dify_config
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
from core.db.session_factory import session_factory
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.account import Account
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import EndUser
from models.workflow import Workflow, WorkflowRun
from repositories.conversation_file_access import execution_file_references
from repositories.web_workflow_admission_repository import WebWorkflowAdmissionRepository

type WebWorkflowEntity = AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity


def _run_id(entity: WebWorkflowEntity) -> str:
    run_id = (
        entity.workflow_run_id if isinstance(entity, AdvancedChatAppGenerateEntity) else entity.workflow_execution_id
    )
    if not run_id:
        raise ValueError("Workflow run ID is required")
    return run_id


def _finish_incomplete(entity: WebWorkflowEntity) -> None:
    WebWorkflowAdmissionRepository(session_factory.get_session_maker()).finish_unstarted_or_incomplete(
        tenant_id=entity.app_config.tenant_id,
        app_id=entity.app_config.app_id,
        end_user_id=entity.user_id,
        run_id=_run_id(entity),
    )


@contextmanager
def web_workflow_launch(
    entity: WebWorkflowEntity,
    *,
    workflow: Workflow,
    user: Account | EndUser,
    conversation_id: str | None,
    resume: bool,
) -> Generator[None]:
    if entity.invoke_from != InvokeFrom.WEB_APP or not dify_config.WEBAPP_ACCOUNT_PASSPORT_ENABLED:
        yield
        return
    if not isinstance(user, EndUser) or user.id != entity.user_id:
        raise ValueError("Web execution requires its original EndUser identity.")
    uploads, tools = execution_file_references((entity.inputs, entity.files))
    run = WorkflowRun(
        id=_run_id(entity),
        tenant_id=entity.app_config.tenant_id,
        app_id=entity.app_config.app_id,
        workflow_id=workflow.id,
        task_id=entity.task_id,
        type=workflow.type,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version=workflow.version,
        # The existing GraphRunStarted observer supplies the full payload after launch.
        graph=None,
        inputs=None,
        connection_context=entity.connection_context.model_dump_json()
        if entity.connection_context is not None
        else None,
        status=WorkflowExecutionStatus.RUNNING,
        outputs="{}",
        error=None,
        elapsed_time=0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.END_USER,
        created_by=user.id,
        created_at=naive_utc_now(),
    )
    repository = WebWorkflowAdmissionRepository(session_factory.get_session_maker())
    try:
        repository.admit(
            run,
            account_id=user.account_id,
            conversation_id=conversation_id,
            upload_ids=uploads,
            tool_ids=tools,
            resume=resume,
        )
    except BaseException:
        if resume:
            _finish_incomplete(entity)
        else:
            repository.reject_pending_message(
                tenant_id=run.tenant_id,
                app_id=run.app_id,
                end_user_id=run.created_by,
                run_id=run.id,
            )
        raise
    try:
        yield
    except BaseException:
        _finish_incomplete(entity)
        raise


@contextmanager
def web_workflow_worker(entity: WebWorkflowEntity) -> Generator[None]:
    try:
        yield
    finally:
        if entity.invoke_from == InvokeFrom.WEB_APP and dify_config.WEBAPP_ACCOUNT_PASSPORT_ENABLED:
            # Successful/paused runs already have their durable final state. Early
            # preparation failures must not leave the pre-launch admission running.
            _finish_incomplete(entity)
