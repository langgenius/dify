import logging
from datetime import timedelta

from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.repositories.human_input_reposotiry import HumanInputFormSubmissionRepository
from core.workflow.enums import WorkflowExecutionStatus
from core.workflow.nodes.human_input.entities import FormDefinition
from core.workflow.nodes.human_input.enums import HumanInputFormStatus, TimeoutUnit
from extensions.ext_database import db
from extensions.ext_storage import storage
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from models.human_input import HumanInputForm
from models.workflow import WorkflowPause, WorkflowRun
from services.human_input_service import HumanInputService

logger = logging.getLogger(__name__)


def _calculate_node_deadline(definition: FormDefinition, created_at, *, start_time=None):
    start = start_time or created_at
    if definition.timeout_unit == TimeoutUnit.HOUR:
        return start + timedelta(hours=definition.timeout)
    if definition.timeout_unit == TimeoutUnit.DAY:
        return start + timedelta(days=definition.timeout)
    raise AssertionError("unknown timeout unit.")


def _is_global_timeout(form_model: HumanInputForm, global_timeout_seconds: int) -> bool:
    if global_timeout_seconds <= 0:
        return False

    form_definition = FormDefinition.model_validate_json(form_model.form_definition)

    created_at = ensure_naive_utc(form_model.created_at)
    expiration_time = ensure_naive_utc(form_model.expiration_time)
    node_deadline = _calculate_node_deadline(form_definition, created_at)
    global_deadline = created_at + timedelta(seconds=global_timeout_seconds)
    return global_deadline <= node_deadline and expiration_time <= global_deadline


def _handle_global_timeout(*, form_id: str, workflow_run_id: str, node_id: str, session_factory: sessionmaker) -> None:
    now = naive_utc_now()
    with session_factory() as session, session.begin():
        workflow_run = session.get(WorkflowRun, workflow_run_id)
        if workflow_run is not None:
            workflow_run.status = WorkflowExecutionStatus.FAILED
            workflow_run.error = f"Human input global timeout at node {node_id}"
            workflow_run.finished_at = now
            session.add(workflow_run)

        pause_model = session.scalar(select(WorkflowPause).where(WorkflowPause.workflow_run_id == workflow_run_id))
        if pause_model is not None:
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


@shared_task(name="human_input_form_timeout.check_and_resume")
def check_and_handle_human_input_timeouts(limit: int = 100) -> None:
    """Scan for expired human input forms and resume or end workflows."""

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    form_repo = HumanInputFormSubmissionRepository(session_factory)
    service = HumanInputService(session_factory, form_repository=form_repo)
    now = naive_utc_now()
    global_timeout_seconds = dify_config.HITL_GLOBAL_TIMEOUT_SECONDS

    with session_factory() as session:
        stmt = (
            select(HumanInputForm)
            .where(
                HumanInputForm.status == HumanInputFormStatus.WAITING,
                HumanInputForm.expiration_time <= now,
            )
            .limit(limit)
        )
        expired_forms = session.scalars(stmt).all()

    for form_model in expired_forms:
        try:
            is_global = _is_global_timeout(form_model, global_timeout_seconds)
            record = form_repo.mark_timeout(
                form_id=form_model.id,
                reason="global_timeout" if is_global else "node_timeout",
            )
            if is_global:
                _handle_global_timeout(
                    form_id=record.form_id,
                    workflow_run_id=record.workflow_run_id,
                    node_id=record.node_id,
                    session_factory=session_factory,
                )
            else:
                service._enqueue_resume(record.workflow_run_id)
        except Exception:
            logger.exception(
                "Failed to handle timeout for form_id=%s workflow_run_id=%s",
                getattr(form_model, "id", None),
                getattr(form_model, "workflow_run_id", None),
            )
