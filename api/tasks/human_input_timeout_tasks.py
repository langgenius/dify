import logging
from datetime import timedelta

from celery import shared_task
from sqlalchemy import or_, select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.ops.unified_trace.human_wait import HumanWaitRecord, try_build_human_wait_record
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


def _enqueue_global_timeout_trace(
    *,
    workflow_run: WorkflowRun,
    serialized_pause_state: bytes,
    human_wait: HumanWaitRecord | None,
) -> None:
    try:
        resumption_context = WorkflowResumptionContext.loads(serialized_pause_state.decode())
        generate_entity = resumption_context.get_generate_entity()
        trace_state = generate_entity.workflow_trace_state
        if human_wait is not None:
            trace_state.human_waits = [wait for wait in trace_state.human_waits if wait.wait_id != human_wait.wait_id]
            trace_state.human_waits.append(human_wait)

        extras = generate_entity.extras
        trace_manager = TraceQueueManager(app_id=workflow_run.app_id, user_id=generate_entity.user_id)
        trace_manager.add_trace_task(
            TraceTask(
                TraceTaskName.WORKFLOW_TRACE,
                workflow_run_id=workflow_run.id,
                workflow_total_tokens=workflow_run.total_tokens,
                conversation_id=getattr(generate_entity, "conversation_id", None),
                user_id=generate_entity.user_id,
                external_trace_id=extras.get("external_trace_id"),
                trace_session_id=extras.get("trace_session_id"),
                parent_trace_context=extras.get("parent_trace_context"),
                agent_fragments=trace_state.agent_fragments_by_parent(),
                human_waits=[wait.model_dump(mode="json") for wait in trace_state.human_waits],
            )
        )
    except Exception:
        logger.warning(
            "Failed to publish global-timeout trace for workflow_run_id=%s",
            workflow_run.id,
            exc_info=True,
        )


def _handle_global_timeout(
    *,
    form_id: str,
    workflow_run_id: str,
    node_id: str,
    session_factory: sessionmaker,
    human_wait: HumanWaitRecord | None = None,
) -> None:
    now = naive_utc_now()
    with session_factory() as session, session.begin():
        workflow_run = session.get(WorkflowRun, workflow_run_id)
        if workflow_run is not None:
            workflow_run.status = WorkflowExecutionStatus.STOPPED
            workflow_run.error = f"Human input global timeout at node {node_id}"
            workflow_run.finished_at = now
            session.add(workflow_run)

        pause_model = session.scalar(select(WorkflowPause).where(WorkflowPause.workflow_run_id == workflow_run_id))
        if pause_model is not None:
            try:
                serialized_pause_state = storage.load(pause_model.state_object_key)
                if workflow_run is not None:
                    _enqueue_global_timeout_trace(
                        workflow_run=workflow_run,
                        serialized_pause_state=serialized_pause_state,
                        human_wait=human_wait,
                    )
            except Exception:
                logger.warning(
                    "Failed to restore pause state for global-timeout trace, form_id=%s, workflow_run_id=%s",
                    form_id,
                    workflow_run_id,
                    exc_info=True,
                )
            try:
                storage.delete(pause_model.state_object_key)
            except Exception:
                logger.exception(
                    "Failed to delete pause state object for workflow_run_id=%s, pause_id=%s",
                    workflow_run_id,
                    pause_model.id,
                )
            pause_model.resumed_at = now
            session.add(pause_model)


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
                human_wait = try_build_human_wait_record(
                    record,
                    owner_kind="workflow_node",
                    owner_id=record.node_id,
                )
                _handle_global_timeout(
                    form_id=record.form_id,
                    workflow_run_id=record.workflow_run_id,
                    node_id=record.node_id,
                    session_factory=session_factory,
                    human_wait=human_wait,
                )
            elif record.workflow_run_id is not None:
                # Workflow Agent node / Human Input node form: resume the workflow.
                service.enqueue_resume(
                    record.workflow_run_id,
                    human_wait=try_build_human_wait_record(
                        record,
                        owner_kind="workflow_node",
                        owner_id=record.node_id,
                    ),
                )
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
