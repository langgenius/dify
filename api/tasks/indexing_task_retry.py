"""Shared retry and terminal-failure rules for knowledge index mutation tasks.

Invariants owned here:

- A task attempt is *final* exactly when Celery will not run the task again
  for a retryable error. Compensation that resolves user-visible state must
  run only on a final attempt; an attempt that will be retried still owns the
  pending work.
- Lock contention on the per-document index lock is not a failure. Tasks that
  must eventually run wait for it with a capped backoff instead of consuming
  a bounded retry budget.
- Terminal compensation never clobbers a document that another worker has
  since picked up: every write re-reads the row under the repository's
  dataset-then-document lock order and applies only while the caller's
  ownership predicate still holds.

Celery keeps one retry counter per message. Lock-busy waits therefore also
advance ``request.retries``; after a long wait, a later genuine error may be
treated as final earlier than its budget suggests. That only shortens the
bounded budget and never makes a retryable attempt look non-final.

``Task.retry(max_retries=N)`` is deliberately not used to lift the bound for
one lock-busy retry: Celery stores that override on the shared task instance
and the autoretry wrapper later applies it to unrelated failures. Tasks that
wait without limit therefore declare ``max_retries=None`` and enforce their
bounded budget with ``is_final_attempt`` and ``TaskRetriesExhaustedError``.
"""

import logging
from collections.abc import Callable, Sequence
from typing import Protocol

from celery import Task
from celery.exceptions import Ignore, Reject, Retry
from celery.utils.time import get_exponential_backoff_interval
from sqlalchemy import select

from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from models.dataset import Document
from models.enums import IndexingStatus
from repositories.knowledge.document_repository import _lock_document
from services.knowledge.entities.resource_scope import DatasetRef

logger = logging.getLogger(__name__)

LOCK_BUSY_RETRY_MAX_SECONDS = 60


class TaskRetriesExhaustedError(RuntimeError):
    """A retryable failure repeated until the task's bounded retry budget was spent.

    Tasks that wait without limit for a busy index lock must leave Celery's own
    ``max_retries`` unbounded, so they raise this non-retryable error on their
    final attempt to end the task as failed. The original failure is ``__cause__``.
    """


def is_final_attempt(task: Task, *, max_retries: int | None) -> bool:
    """Return whether the current attempt has spent a bounded retry budget.

    Precondition: called while ``task`` is executing a request (or directly,
    where ``request.retries`` is ``0``). ``max_retries`` is the budget the
    caller enforces: ``task.max_retries`` when Celery bounds the task, or the
    task's own constant when only non-lock failures are bounded.
    Postcondition: ``True`` exactly when ``max_retries`` is bounded and already
    consumed, matching ``Task.retry``'s ``retries > max_retries`` refusal of
    the next attempt. An unbounded budget is never final.
    """

    return max_retries is not None and task.request.retries >= max_retries


def lock_busy_countdown(task: Task) -> int:
    """Return the capped exponential delay before re-contending for a busy index lock."""

    return get_exponential_backoff_interval(
        factor=1,
        retries=task.request.retries,
        maximum=LOCK_BUSY_RETRY_MAX_SECONDS,
        full_jitter=False,
    )


def is_terminal_failure(
    task: Task,
    error: Exception,
    *,
    retryable: tuple[type[Exception], ...],
    max_retries: int | None,
) -> bool:
    """Return whether ``error`` ends the task instead of scheduling another attempt.

    Precondition: ``retryable`` lists exactly the errors the task retries and
    ``max_retries`` is the budget those retries share.
    Postcondition: ``True`` for a non-retryable error, or for a retryable one
    on the final attempt. Celery control-flow signals are never terminal
    failures.
    """

    if isinstance(error, (Retry, Ignore, Reject)):
        return False
    return not isinstance(error, retryable) or is_final_attempt(task, max_retries=max_retries)


class IndexingCacheClient(Protocol):
    """The single Redis operation needed to drop compatibility indexing flags."""

    def delete(self, *names: str) -> object: ...


def clear_document_indexing_cache(redis: IndexingCacheClient, document_id: str) -> None:
    """Best-effort removal of the ``document_{id}_indexing`` flag; never raises."""

    try:
        redis.delete(f"document_{document_id}_indexing")
    except Exception:
        logger.warning("Failed to clear indexing cache for document %s", document_id, exc_info=True)


def clear_segment_indexing_cache(redis: IndexingCacheClient, segment_ids: Sequence[str]) -> None:
    """Best-effort removal of each ``segment_{id}_indexing`` flag; never raises."""

    for segment_id in segment_ids:
        try:
            redis.delete(f"segment_{segment_id}_indexing")
        except Exception:
            logger.warning("Failed to clear indexing cache for segment %s", segment_id, exc_info=True)


def mark_document_indexing_error(document: Document, error: str) -> None:
    """Move a locked document to the user-retryable ``error`` state."""

    document.indexing_status = IndexingStatus.ERROR
    document.error = error
    document.stopped_at = naive_utc_now()


def resolve_documents_after_terminal_failure(
    document_ids: Sequence[str],
    *,
    still_owned: Callable[[Document], bool],
    resolve: Callable[[Document], None],
) -> tuple[str, ...]:
    """Resolve documents a terminally failed task left in a transitional state.

    Preconditions: the calling attempt is final (see ``is_final_attempt``) or
    failed with a non-retryable error, and it no longer holds a database
    transaction.
    Postconditions: for every returned id, ``resolve`` was applied and
    committed while ``still_owned`` held on the locked row. Documents that are
    missing or no longer satisfy ``still_owned`` are left untouched.
    Failure behavior: never raises. A persistence error is logged with the
    affected document id so the caller can re-raise its original failure.
    """

    resolved: list[str] = []
    for document_id in dict.fromkeys(document_ids):
        try:
            with session_factory.create_session() as session:
                scope = session.execute(
                    select(Document.tenant_id, Document.dataset_id).where(Document.id == document_id).limit(1)
                ).one_or_none()
                if scope is not None:
                    document_ref = DatasetRef(scope.tenant_id, scope.dataset_id).document(document_id)
                    document = _lock_document(session, document_ref)
                    if document is not None and still_owned(document):
                        resolve(document)
                        session.commit()
                        resolved.append(document_id)
                    else:
                        session.rollback()
        except Exception:
            logger.exception("Failed to resolve document after terminal task failure: document_id=%s", document_id)
    return tuple(resolved)
