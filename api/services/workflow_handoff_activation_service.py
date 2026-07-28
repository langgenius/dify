import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from celery import current_app as current_celery_app
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.workflow_handoff import WorkflowRunHandoff
from repositories.sqlalchemy_workflow_handoff_repository import SQLAlchemyWorkflowRunHandoffRepository
from repositories.workflow_handoff_repository import WorkflowRunHandoffRepository

logger = logging.getLogger(__name__)

WORKFLOW_HANDOFF_RESUME_TASK_NAME = "workflow_handoff.resume"


@dataclass(frozen=True)
class WorkflowHandoffActivationResult:
    handoff: WorkflowRunHandoff | None
    enqueued: bool = False
    dispatch_marked: bool = False
    errors: int = 0

    @property
    def activated(self) -> bool:
        return self.handoff is not None


class WorkflowHandoffActivationService:
    """Cross the drain barrier, then dispatch through the durable outbox.

    The repository commits PREPARED -> READY before this class touches the
    broker. If broker publication or ``mark_dispatched`` fails, the READY row is
    deliberately left for the periodic scanner to repair.
    """

    def __init__(
        self,
        *,
        repository: WorkflowRunHandoffRepository,
        enqueue: Callable[[str, int], None],
    ) -> None:
        self._repository = repository
        self._enqueue = enqueue

    def activate(self, *, task_id: str, now: datetime) -> WorkflowHandoffActivationResult:
        handoff = self._repository.activate_latest_prepared_by_task_id(
            task_id=task_id,
            activated_at=now,
        )
        if handoff is None:
            return WorkflowHandoffActivationResult(handoff=None)

        try:
            self._enqueue(handoff.id, handoff.generation)
        except Exception:
            logger.exception(
                "Failed to enqueue activated workflow handoff; scanner will retry: handoff_id=%s, generation=%s",
                handoff.id,
                handoff.generation,
            )
            return WorkflowHandoffActivationResult(handoff=handoff, errors=1)

        try:
            dispatch_marked = self._repository.mark_dispatched(
                handoff_id=handoff.id,
                generation=handoff.generation,
                dispatched_at=now,
            )
        except Exception:
            logger.exception(
                "Failed to mark activated workflow handoff dispatched; scanner will retry: "
                "handoff_id=%s, generation=%s",
                handoff.id,
                handoff.generation,
            )
            return WorkflowHandoffActivationResult(handoff=handoff, enqueued=True, errors=1)

        return WorkflowHandoffActivationResult(
            handoff=handoff,
            enqueued=True,
            dispatch_marked=dispatch_marked,
        )


def activate_workflow_handoff_by_task_id(task_id: str) -> WorkflowHandoffActivationResult:
    """Runtime helper for response pipelines after the old segment fully drains."""

    repository = SQLAlchemyWorkflowRunHandoffRepository(
        sessionmaker(bind=db.engine, expire_on_commit=False),
    )

    def _enqueue(handoff_id: str, generation: int) -> None:
        current_celery_app.send_task(
            WORKFLOW_HANDOFF_RESUME_TASK_NAME,
            kwargs={"handoff_id": handoff_id, "generation": generation},
            queue=dify_config.WORKFLOW_HANDOFF_QUEUE,
        )

    return WorkflowHandoffActivationService(
        repository=repository,
        enqueue=_enqueue,
    ).activate(task_id=task_id, now=naive_utc_now())


__all__ = [
    "WORKFLOW_HANDOFF_RESUME_TASK_NAME",
    "WorkflowHandoffActivationResult",
    "WorkflowHandoffActivationService",
    "activate_workflow_handoff_by_task_id",
]
