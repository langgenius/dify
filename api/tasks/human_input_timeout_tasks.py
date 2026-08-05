import logging
from datetime import timedelta

from celery import shared_task
from sqlalchemy import or_, select, update
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from core.ops.entities.config_entity import workflow_final_trace_file_id
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.ops.unified_trace.human_wait import try_build_human_wait_record
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from extensions.ext_database import db
from extensions.ext_storage import storage
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from models.human_input import HumanInputForm
from models.workflow import FinalTraceHandoffStatus, WorkflowPause, WorkflowPauseReason, WorkflowRun
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


def _attempt_pending_final_trace_handoff(pause_id: str, session_factory: sessionmaker) -> None:
    max_attempts = dify_config.OPS_TRACE_FINAL_TRACE_HANDOFF_MAX_RETRIES
    with session_factory() as session, session.begin():
        claimed = session.execute(
            update(WorkflowPause)
            .where(
                WorkflowPause.id == pause_id,
                WorkflowPause.final_trace_status == FinalTraceHandoffStatus.PENDING,
                WorkflowPause.final_trace_attempts < max_attempts,
            )
            .values(final_trace_attempts=WorkflowPause.final_trace_attempts + 1)
            .returning(
                WorkflowPause.workflow_run_id,
                WorkflowPause.state_object_key,
                WorkflowPause.final_trace_attempts,
            )
        ).one_or_none()

    if claimed is None:
        return

    workflow_run_id, state_object_key, attempt = claimed
    stage = "persist"
    try:
        serialized_pause_state = storage.load(state_object_key)
        resumption_context = WorkflowResumptionContext.loads(serialized_pause_state.decode())
        with session_factory() as session:
            workflow_run = session.get(WorkflowRun, workflow_run_id)
            if workflow_run is None:
                raise LookupError(f"workflow run {workflow_run_id} does not exist")
            expired_forms = session.execute(
                select(HumanInputForm, WorkflowPauseReason.node_id)
                .join(WorkflowPauseReason, WorkflowPauseReason.form_id == HumanInputForm.id)
                .where(
                    WorkflowPauseReason.pause_id == pause_id,
                    HumanInputForm.status == HumanInputFormStatus.EXPIRED,
                )
                .order_by(WorkflowPauseReason.id.asc())
            ).all()

        generate_entity = resumption_context.get_generate_entity()
        trace_state = generate_entity.workflow_trace_state
        human_waits_by_id = {wait.wait_id: wait for wait in trace_state.human_waits}
        for form, node_id in expired_forms:
            human_wait = try_build_human_wait_record(
                form,
                owner_kind="workflow_node",
                owner_id=node_id,
            )
            if human_wait is not None:
                human_waits_by_id[human_wait.wait_id] = human_wait
        trace_state.human_waits = list(human_waits_by_id.values())

        extras = generate_entity.extras
        trace_manager = TraceQueueManager(app_id=workflow_run.app_id, user_id=generate_entity.user_id)
        file_info = trace_manager.persist_trace_task(
            TraceTask(
                TraceTaskName.WORKFLOW_TRACE,
                workflow_run_id=workflow_run.id,
                workflow_total_tokens=workflow_run.total_tokens,
                conversation_id=(
                    generate_entity.conversation_id
                    if isinstance(generate_entity, AdvancedChatAppGenerateEntity)
                    else None
                ),
                user_id=generate_entity.user_id,
                external_trace_id=extras.get("external_trace_id"),
                trace_session_id=extras.get("trace_session_id"),
                parent_trace_context=extras.get("parent_trace_context"),
                agent_fragments=trace_state.agent_fragments_by_parent(),
                human_waits=[wait.model_dump(mode="json") for wait in trace_state.human_waits],
            ),
            file_id=workflow_final_trace_file_id(workflow_run.id),
        )
        if file_info is not None:
            stage = "enqueue"
            trace_manager.enqueue_persisted_trace(file_info)
    except Exception as exc:
        logger.warning(
            "Final trace handoff failed workflow_run_id=%s pause_id=%s attempt=%s stage=%s exception_type=%s",
            workflow_run_id,
            pause_id,
            attempt,
            stage,
            type(exc).__name__,
        )
        if attempt >= max_attempts:
            with session_factory() as session, session.begin():
                exhausted = session.execute(
                    update(WorkflowPause)
                    .where(
                        WorkflowPause.id == pause_id,
                        WorkflowPause.final_trace_status == FinalTraceHandoffStatus.PENDING,
                        WorkflowPause.final_trace_attempts == attempt,
                    )
                    .values(final_trace_status=FinalTraceHandoffStatus.FAILED)
                )
            if exhausted.rowcount:
                logger.log(
                    logging.ERROR,
                    "Final trace handoff exhausted workflow_run_id=%s pause_id=%s attempts=%s "
                    "stage=%s exception_type=%s",
                    workflow_run_id,
                    pause_id,
                    attempt,
                    stage,
                    type(exc).__name__,
                )
        return

    with session_factory() as session, session.begin():
        cleared = session.execute(
            update(WorkflowPause)
            .where(
                WorkflowPause.id == pause_id,
                WorkflowPause.final_trace_status == FinalTraceHandoffStatus.PENDING,
            )
            .values(final_trace_status=None)
        )
    if not cleared.rowcount:
        return

    try:
        storage.delete(state_object_key)
    except Exception as exc:
        logger.warning(
            "Final trace snapshot cleanup failed workflow_run_id=%s pause_id=%s exception_type=%s",
            workflow_run_id,
            pause_id,
            type(exc).__name__,
        )


def _handle_global_timeout(
    *,
    form_id: str,
    workflow_run_id: str,
    node_id: str,
    session_factory: sessionmaker,
) -> None:
    now = naive_utc_now()
    pending_pause_id: str | None = None
    with session_factory() as session, session.begin():
        workflow_run = session.get(WorkflowRun, workflow_run_id)
        if workflow_run is not None:
            workflow_run.status = WorkflowExecutionStatus.STOPPED
            workflow_run.error = f"Human input global timeout at node {node_id}"
            workflow_run.finished_at = now
            session.add(workflow_run)

        pause_model = session.scalar(select(WorkflowPause).where(WorkflowPause.workflow_run_id == workflow_run_id))
        if pause_model is not None:
            pause_model.resumed_at = now
            pause_model.final_trace_status = FinalTraceHandoffStatus.PENDING
            pause_model.final_trace_attempts = 0
            session.add(pause_model)
            pending_pause_id = pause_model.id

    if pending_pause_id is not None:
        _attempt_pending_final_trace_handoff(pending_pause_id, session_factory)


@shared_task(name="human_input_form_timeout.check_and_resume", queue="schedule_executor")
def check_and_handle_human_input_timeouts(limit: int = 100) -> None:
    """Scan for expired human input forms and resume or end workflows."""

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    form_repo = HumanInputFormSubmissionRepository()
    service = HumanInputService(session_factory, form_repository=form_repo)
    now = naive_utc_now()
    global_timeout_seconds = dify_config.HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS

    with session_factory() as session:
        pending_pause_ids = session.scalars(
            select(WorkflowPause.id)
            .where(WorkflowPause.final_trace_status == FinalTraceHandoffStatus.PENDING)
            .order_by(WorkflowPause.updated_at.asc(), WorkflowPause.id.asc())
            .limit(limit)
        ).all()
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

    for pause_id in pending_pause_ids:
        _attempt_pending_final_trace_handoff(pause_id, session_factory)

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
