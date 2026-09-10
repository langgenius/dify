"""Coordinate workflow resumes when parallel HITL form submissions race."""

import logging
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired, PauseReason
from models.human_input import HumanInputForm

logger = logging.getLogger(__name__)


def _hitl_form_ids_from_pause_reasons(pause_reasons: Sequence[PauseReason]) -> list[str]:
    return [reason.form_id for reason in pause_reasons if isinstance(reason, HumanInputRequired)]


def all_hitl_forms_submitted(session: Session, form_ids: Sequence[str]) -> bool:
    if not form_ids:
        return False

    unique_form_ids = list(dict.fromkeys(form_ids))
    forms = session.scalars(select(HumanInputForm).where(HumanInputForm.id.in_(unique_form_ids))).all()
    if len(forms) != len(unique_form_ids):
        return False

    return all(
        form.status == HumanInputFormStatus.SUBMITTED or form.submitted_at is not None for form in forms
    )


def maybe_enqueue_resume_for_submitted_hitl_pause(
    *,
    workflow_run_id: str,
    pause_reasons: Sequence[PauseReason],
    session_factory: sessionmaker[Session],
) -> None:
    """Enqueue a follow-up resume when a pause still references already-submitted HITL forms.

    Parallel form submissions can enqueue overlapping resume tasks. The first task
    may pause again before the second submission is observed, leaving the workflow
    stuck even though every form is already submitted in the database.
    """
    form_ids = _hitl_form_ids_from_pause_reasons(pause_reasons)
    if not form_ids:
        return

    with session_factory() as session:
        if not all_hitl_forms_submitted(session, form_ids):
            return

    logger.info(
        "All HITL forms already submitted for paused workflow run %s; enqueueing follow-up resume",
        workflow_run_id,
    )
    try:
        from tasks.app_generate.workflow_execute_task import resume_app_execution

        resume_app_execution.apply_async(kwargs={"payload": {"workflow_run_id": workflow_run_id}})
    except Exception:  # pragma: no cover
        logger.exception("Failed to enqueue follow-up resume for workflow run %s", workflow_run_id)
