import logging
from datetime import timedelta
from itertools import starmap
from typing import NamedTuple

from celery import shared_task
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from extensions.ext_database import db
from extensions.ext_storage import storage
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from models.human_input import HumanInputForm
from models.workflow import WorkflowPause, WorkflowPauseReason, WorkflowRun
from services.human_input_service import HumanInputService

logger = logging.getLogger(__name__)


class _TerminalPause(NamedTuple):
    workflow_run_id: str
    pause_id: str
    form_id: str
    status: HumanInputFormStatus
    node_id: str


def _is_global_timeout(form_model: HumanInputForm, global_timeout_seconds: int, *, now) -> bool:
    if global_timeout_seconds <= 0:
        return False
    if form_model.workflow_run_id is None:
        return False
    created_at = ensure_naive_utc(form_model.created_at)
    global_deadline = created_at + timedelta(seconds=global_timeout_seconds)
    return global_deadline <= now


def _handle_global_timeout(
    *,
    form_id: str,
    workflow_run_id: str,
    pause_id: str,
    node_id: str,
    session_factory: sessionmaker,
) -> bool:
    now = naive_utc_now()
    state_object_key: str | None = None
    with session_factory() as session, session.begin():
        workflow_run = session.scalar(
            select(WorkflowRun).where(WorkflowRun.id == workflow_run_id).with_for_update(of=WorkflowRun)
        )
        if workflow_run is None or workflow_run.status != WorkflowExecutionStatus.PAUSED:
            return False

        pause_model = session.scalar(
            select(WorkflowPause).where(
                WorkflowPause.id == pause_id,
                WorkflowPause.workflow_run_id == workflow_run_id,
                WorkflowPause.resumed_at.is_(None),
            )
        )
        if pause_model is None:
            return False
        current_expired_form = session.scalar(
            select(HumanInputForm.id)
            .join(
                WorkflowPauseReason,
                (WorkflowPauseReason.form_id == HumanInputForm.id) & (WorkflowPauseReason.pause_id == pause_model.id),
            )
            .where(
                HumanInputForm.id == form_id,
                HumanInputForm.workflow_run_id == workflow_run_id,
                HumanInputForm.status == HumanInputFormStatus.EXPIRED,
            )
        )
        if current_expired_form is None:
            return False

        workflow_run.status = WorkflowExecutionStatus.STOPPED
        workflow_run.error = f"Human input global timeout at node {node_id}"
        workflow_run.finished_at = now
        workflow_run.stop_requested_at = workflow_run.stop_requested_at or now
        state_object_key = pause_model.state_object_key
        pause_model.resumed_at = now
        session.add_all([workflow_run, pause_model])

    if state_object_key is not None:
        try:
            storage.delete(state_object_key)
        except Exception:
            logger.exception("Failed to delete pause state object for workflow_run_id=%s", workflow_run_id)
    return True


def _terminal_pauses(
    session_factory: sessionmaker,
    *,
    after: tuple[str, str] | None,
    limit: int,
) -> tuple[_TerminalPause, ...]:
    statement = (
        select(
            WorkflowRun.id,
            WorkflowPause.id,
            HumanInputForm.id,
            HumanInputForm.status,
            HumanInputForm.node_id,
        )
        .join(HumanInputForm, HumanInputForm.workflow_run_id == WorkflowRun.id)
        .join(WorkflowPause, WorkflowPause.workflow_run_id == WorkflowRun.id)
        .join(
            WorkflowPauseReason,
            (WorkflowPauseReason.pause_id == WorkflowPause.id) & (WorkflowPauseReason.form_id == HumanInputForm.id),
        )
        .where(
            HumanInputForm.form_kind == HumanInputFormKind.RUNTIME,
            HumanInputForm.status.in_(
                (
                    HumanInputFormStatus.SUBMITTED,
                    HumanInputFormStatus.TIMEOUT,
                    HumanInputFormStatus.EXPIRED,
                )
            ),
            WorkflowRun.status == WorkflowExecutionStatus.PAUSED,
            WorkflowPause.resumed_at.is_(None),
        )
        .distinct()
        .order_by(WorkflowRun.id.asc(), HumanInputForm.id.asc())
        .limit(limit)
    )
    if after is not None:
        after_run_id, after_form_id = after
        statement = statement.where(
            or_(
                WorkflowRun.id > after_run_id,
                and_(WorkflowRun.id == after_run_id, HumanInputForm.id > after_form_id),
            )
        )
    with session_factory() as session:
        return tuple(starmap(_TerminalPause, session.execute(statement).tuples()))


@shared_task(name="human_input_form_timeout.check_and_resume", queue="schedule_executor")
def check_and_handle_human_input_timeouts(limit: int = 100) -> None:
    """Mark newly expired forms and recover terminal runtime pauses."""

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
            if record.workflow_run_id is None:
                logger.warning(
                    "Timed-out form %s has no workflow_run_id; skipping resume",
                    record.form_id,
                )
        except Exception:
            logger.exception(
                "Failed to handle timeout for form_id=%s workflow_run_id=%s",
                form_model.id,
                form_model.workflow_run_id,
            )

    after: tuple[str, str] | None = None
    while terminal_pauses := _terminal_pauses(session_factory, after=after, limit=limit):
        for terminal in terminal_pauses:
            try:
                if terminal.status == HumanInputFormStatus.EXPIRED:
                    _handle_global_timeout(
                        form_id=terminal.form_id,
                        workflow_run_id=terminal.workflow_run_id,
                        pause_id=terminal.pause_id,
                        node_id=terminal.node_id,
                        session_factory=session_factory,
                    )
                else:
                    service.enqueue_resume(terminal.workflow_run_id)
            except Exception:
                logger.exception(
                    "Failed to recover terminal human input for form_id=%s workflow_run_id=%s",
                    terminal.form_id,
                    terminal.workflow_run_id,
                )
        last = terminal_pauses[-1]
        after = (last.workflow_run_id, last.form_id)
