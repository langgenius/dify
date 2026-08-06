import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from repositories.workflow_handoff_repository import WorkflowRunHandoffRepository

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WorkflowHandoffDispatchResult:
    exhausted_failed: int
    due: int
    enqueued: int
    dispatch_marked: int
    errors: int
    stale_prepared_failed: int = 0
    stale_ready_failed: int = 0


class WorkflowHandoffDispatcher:
    """Scan the durable handoff outbox and enqueue fenced resume attempts.

    Enqueueing intentionally happens before ``mark_dispatched``. A process crash
    can therefore create a duplicate message, but the lease-token claim makes it
    harmless. Reversing the order could lose a handoff until the redispatch
    deadline when the broker write fails.
    """

    def __init__(
        self,
        *,
        repository: WorkflowRunHandoffRepository,
        enqueue: Callable[[str, int], None],
    ) -> None:
        self._repository = repository
        self._enqueue = enqueue

    def scan(
        self,
        *,
        now: datetime,
        redispatch_interval: timedelta,
        prepared_timeout: timedelta,
        max_attempts: int,
        limit: int,
    ) -> WorkflowHandoffDispatchResult:
        if prepared_timeout.total_seconds() <= 0:
            raise ValueError("prepared_timeout must be positive")
        stale_prepared_failed = self._repository.fail_stale_prepared(
            now=now,
            stale_before=now - prepared_timeout,
            error="workflow handoff drain barrier timed out before activation",
            limit=limit,
        )
        stale_ready_failed = self._repository.fail_stale_ready(
            now=now,
            stale_before=now - prepared_timeout,
            error="workflow handoff timed out before the first resume attempt",
            limit=limit,
        )
        exhausted_failed = self._repository.fail_exhausted(
            now=now,
            max_attempts=max_attempts,
            error=f"workflow handoff exhausted {max_attempts} resume attempts",
        )
        due_handoffs = self._repository.list_due(
            now=now,
            redispatch_interval=redispatch_interval,
            max_attempts=max_attempts,
            limit=limit,
        )

        enqueued = 0
        dispatch_marked = 0
        errors = 0
        for handoff in due_handoffs:
            try:
                self._enqueue(handoff.id, handoff.generation)
                enqueued += 1
            except Exception:
                errors += 1
                logger.exception(
                    "Failed to enqueue workflow handoff resume: handoff_id=%s, generation=%s",
                    handoff.id,
                    handoff.generation,
                )
                continue

            try:
                if self._repository.mark_dispatched(
                    handoff_id=handoff.id,
                    generation=handoff.generation,
                    dispatched_at=now,
                ):
                    dispatch_marked += 1
            except Exception:
                # The broker already owns a message. Leaving the row unmarked is
                # safe and makes the next scan redispatch it; claim fencing keeps
                # that duplicate from starting another graph.
                errors += 1
                logger.exception(
                    "Failed to mark workflow handoff dispatched: handoff_id=%s, generation=%s",
                    handoff.id,
                    handoff.generation,
                )

        return WorkflowHandoffDispatchResult(
            exhausted_failed=exhausted_failed,
            due=len(due_handoffs),
            enqueued=enqueued,
            dispatch_marked=dispatch_marked,
            errors=errors,
            stale_prepared_failed=stale_prepared_failed,
            stale_ready_failed=stale_ready_failed,
        )


__all__ = ["WorkflowHandoffDispatchResult", "WorkflowHandoffDispatcher"]
