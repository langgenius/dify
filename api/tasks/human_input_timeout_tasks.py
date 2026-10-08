import logging
from datetime import timedelta

from celery import shared_task
from sqlalchemy import or_, select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from enums.human_input import HumanInputFormKind, HumanInputFormStatus
from extensions.ext_database import db
from extensions.ext_storage import storage
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from models.enums import CreatorUserRole
from models.human_input import HumanInputForm
from models.workflow import WorkflowPause, WorkflowRun
from repositories.human_input.form_repository import HumanInputFormSubmissionRepository
from repositories.workflow.execution_write_repository import sync_debug_lease_status
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.human_input_service import HumanInputService

logger = logging.getLogger(__name__)


def _is_global_timeout(form_model: HumanInputForm, global_timeout_seconds: int, *, now) -> bool:
    if global_timeout_seconds <= 0:
        return False
    if form_model.workflow_run_id is None:
        return False
    created_at = ensure_naive_utc(form_model.created_at)
    global_deadline = created_at + timedelta(seconds=global_timeout_seconds)
    return global_deadline <= now


def _handle_global_timeout(*, form_id: str, workflow_run_id: str, node_id: str, session_factory: sessionmaker) -> None:
    now = naive_utc_now()
    with session_factory() as session, session.begin():
        workflow_run = session.scalar(
            select(WorkflowRun)
            .join(
                HumanInputForm,
                (HumanInputForm.workflow_run_id == WorkflowRun.id)
                & (HumanInputForm.tenant_id == WorkflowRun.tenant_id)
                & (HumanInputForm.app_id == WorkflowRun.app_id),
            )
            .where(HumanInputForm.id == form_id, WorkflowRun.id == workflow_run_id)
            .with_for_update(of=WorkflowRun)
        )
        if workflow_run is None:
            return
        if not workflow_run.status.is_ended():
            workflow_run.status = WorkflowExecutionStatus.STOPPED
            workflow_run.error = f"Human input global timeout at node {node_id}"
            workflow_run.finished_at = now
            session.add(workflow_run)
            sync_debug_lease_status(session, workflow_run)

        pause_model = session.scalar(select(WorkflowPause).where(WorkflowPause.workflow_run_id == workflow_run_id))
        state_object_key = None
        if pause_model is not None:
            state_object_key = pause_model.state_object_key
            pause_model.resumed_at = now
            session.add(pause_model)
        tenant_id, app_id, workflow_id = workflow_run.tenant_id, workflow_run.app_id, workflow_run.workflow_id
        account_id = workflow_run.created_by if workflow_run.created_by_role == CreatorUserRole.ACCOUNT else None

    if state_object_key is not None:
        try:
            storage.delete(state_object_key)
        except Exception:
            logger.exception("Failed to delete pause state object for workflow_run_id=%s", workflow_run_id)
    WorkflowAgentRetirementService.finish_execution(
        sessions=session_factory,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        execution_id=workflow_run_id,
        account_id=account_id,
    )


@shared_task(name="human_input_form_timeout.check_and_resume", queue="schedule_executor")
def check_and_handle_human_input_timeouts(limit: int = 100) -> None:
    """Scan for expired human input forms and resume or end workflows."""

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    form_repo = HumanInputFormSubmissionRepository()
    service = HumanInputService(session_factory, form_repository=form_repo)
    now = naive_utc_now()
    global_timeout_seconds = dify_config.HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS

    with session_factory() as session:
        global_deadline = now - timedelta(seconds=global_timeout_seconds) if global_timeout_seconds > 0 else None
        timeout_filter = HumanInputForm.expiration_time <= now
        if global_deadline is not None:
            timeout_filter = or_(timeout_filter, HumanInputForm.created_at <= global_deadline)
        stmt = (
            select(HumanInputForm)
            .where(
                HumanInputForm.status == HumanInputFormStatus.WAITING,
                timeout_filter,
            )
            .order_by(HumanInputForm.id.asc())
            .limit(limit)
        )
        expired_forms = session.scalars(stmt).all()

    for form_model in expired_forms:
        try:
            if form_model.form_kind == HumanInputFormKind.DELIVERY_TEST:
                form_repo.mark_timeout(
                    form_id=form_model.id,
                    timeout_status=HumanInputFormStatus.TIMEOUT,
                    reason="delivery_test_timeout",
                )
                continue

            is_global = _is_global_timeout(form_model, global_timeout_seconds, now=now)
            record = form_repo.mark_timeout(
                form_id=form_model.id,
                timeout_status=HumanInputFormStatus.EXPIRED if is_global else HumanInputFormStatus.TIMEOUT,
                reason="global_timeout" if is_global else "node_timeout",
            )
            if is_global:
                # Global timeout applies only to workflow-owned forms
                # (_is_global_timeout requires a workflow_run_id): end the run.
                assert record.workflow_run_id is not None, "global timeout requires a workflow_run_id"
                _handle_global_timeout(
                    form_id=record.form_id,
                    workflow_run_id=record.workflow_run_id,
                    node_id=record.node_id,
                    session_factory=session_factory,
                )
            elif record.workflow_run_id is not None:
                # Workflow Agent node / Human Input node form: resume the workflow.
                service.enqueue_resume(record.workflow_run_id)
            elif record.conversation_id is not None:
                # ENG-635: Agent v2 chat ask_human form is conversation-owned (no
                # workflow_run_id). Resume the chat turn so the timeout is threaded
                # back to the agent run as the ask_human deferred_tool_result
                # (status="timeout"), mirroring HumanInputService.submit_form_by_token.
                service.enqueue_agent_app_resume(conversation_id=record.conversation_id, form_id=record.form_id)
            else:
                logger.warning(
                    "Timed-out form %s has neither workflow_run_id nor conversation_id; skipping resume",
                    record.form_id,
                )
        except Exception:
            logger.exception(
                "Failed to handle timeout for form_id=%s workflow_run_id=%s",
                form_model.id,
                form_model.workflow_run_id,
            )
