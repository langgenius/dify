import logging
from datetime import timedelta

from celery import shared_task
from flask import current_app
from sqlalchemy import or_, select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from core.ops.trace_data import QueuedTrace
from core.ops.workflow_trace import WorkflowTraceRecorder, WorkflowTraceState
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from extensions.ext_database import db
from extensions.ext_storage import storage
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from models.human_input import HumanInputForm
from models.workflow import WorkflowPause, WorkflowRun
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


def _handle_global_timeout(
    *, tenant_id: str, app_id: str, form_id: str, workflow_run_id: str, node_id: str, session_factory: sessionmaker
) -> None:
    now = naive_utc_now()
    error = f"Human input global timeout at node {node_id}"
    with session_factory() as session, session.begin():
        workflow_run = session.scalar(
            select(WorkflowRun)
            .where(
                WorkflowRun.id == workflow_run_id,
                WorkflowRun.tenant_id == tenant_id,
                WorkflowRun.app_id == app_id,
            )
            .with_for_update()
        )
        if workflow_run is None or workflow_run.status != WorkflowExecutionStatus.PAUSED:
            return
        pause_model = session.scalar(
            select(WorkflowPause)
            .where(
                WorkflowPause.workflow_run_id == workflow_run_id,
                WorkflowPause.resumed_at.is_(None),
            )
            .with_for_update()
        )
        if pause_model is None:
            return
        workflow_run.status = WorkflowExecutionStatus.STOPPED
        workflow_run.error = error
        workflow_run.finished_at = now
        workflow_id = workflow_run.workflow_id
        state_object_key = pause_model.state_object_key if pause_model is not None else None
        if pause_model is not None:
            pause_model.resumed_at = now

    if state_object_key is None:
        return
    try:
        resumption = WorkflowResumptionContext.loads(storage.load_once(state_object_key).decode())
        resumption.restore_trace_state(
            tenant_id=tenant_id, app_id=app_id, workflow_id=workflow_id, workflow_run_id=workflow_run_id
        )
        if resumption.ops_trace_state is not None:
            state = WorkflowTraceState.model_validate(resumption.ops_trace_state)
            trace_queue = current_app.extensions.get("ops_trace_queue")
            if trace_queue is not None:

                def submit_trace(completed_trace):
                    accepted = False
                    for settings in state.provider_settings:
                        accepted = (
                            trace_queue.submit_trace(QueuedTrace.from_trace(completed_trace, settings)) or accepted
                        )
                    return accepted

                recorder = WorkflowTraceRecorder(
                    source=state.source,
                    workflow_id=workflow_id,
                    workflow_version=state.workflow_version,
                    inputs={},
                    submit_completed_trace=submit_trace,
                    provider_settings=state.provider_settings,
                    pause_state=resumption.ops_trace_state,
                )
                recorder.finish_workflow_trace(error)
    except Exception:
        logger.exception("Failed to finalize timed-out workflow trace: workflow_run_id=%s", workflow_run_id)
    try:
        storage.delete(state_object_key)
    except Exception:
        logger.exception("Failed to delete timed-out workflow checkpoint: workflow_run_id=%s", workflow_run_id)


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
                    tenant_id=record.tenant_id,
                    app_id=record.app_id,
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
