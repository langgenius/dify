"""SQLAlchemy persistence for knowledge task intents."""

from collections.abc import Callable, Mapping
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import and_, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.task_state_repository import (
    get_current_dataset_vector_rows,
    get_current_document_index_state_rows,
)
from services.knowledge.task_outbox.contracts import (
    DocumentIndexStateAction,
    DocumentIndexStateTaskProjection,
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskFailureDisposition,
    KnowledgeTaskIntent,
    KnowledgeTaskKind,
    KnowledgeTaskRetriesExhaustedError,
    KnowledgeTaskState,
    KnowledgeTaskStatus,
)

_MAX_INDEX_EXECUTION_ATTEMPTS = 10
_CLEANUP_KINDS = frozenset(
    {
        "document_cleanup",
        "document_batch_cleanup",
        "dataset_cleanup",
        "file_cleanup",
        "segment_delete_cleanup",
        "deletion_index_cleanup",
    }
)


def enqueue_knowledge_task(
    session: Session,
    *,
    kind: KnowledgeTaskKind | str,
    tenant_id: str,
    dataset_id: str,
    payload: Mapping[str, object],
    document_id: str | None = None,
    resource_id: str | None = None,
) -> str:
    """Persist an intent in the caller's transaction without committing it."""

    intent = KnowledgeTaskOutbox(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        resource_id=resource_id,
        task_kind=kind.value if isinstance(kind, KnowledgeTaskKind) else kind,
        payload=dict(payload),
    )
    session.add(intent)
    session.flush()
    return intent.id


def guard_task_execution(
    session: Session,
    *,
    intent_id: str,
    execution_id: str,
    now: datetime,
) -> None:
    """Lock and validate a durable execution in the caller's write transaction."""

    owned_intent_id = session.scalar(
        select(KnowledgeTaskOutbox.id)
        .where(
            KnowledgeTaskOutbox.id == intent_id,
            KnowledgeTaskOutbox.status == KnowledgeTaskStatus.EXECUTING,
            KnowledgeTaskOutbox.claim_id == execution_id,
            KnowledgeTaskOutbox.available_at > now,
        )
        .with_for_update()
    )
    if owned_intent_id is None:
        raise KnowledgeTaskExecutionLeaseLostError(f"Knowledge task {intent_id} lost its execution claim")


def get_current_dataset_vector_task_states(
    session: Session,
    *,
    tenant_id: str,
    expected_payload_by_resource: Mapping[str, Mapping[str, object]],
    for_update: bool = False,
) -> dict[str, KnowledgeTaskState]:
    """Return the explicitly current vector intent for each requested dataset."""

    return {
        resource_id: _project_task_state(row)
        for resource_id, row in get_current_dataset_vector_rows(
            session,
            tenant_id=tenant_id,
            expected_payload_by_resource=expected_payload_by_resource,
            for_update=for_update,
        ).items()
    }


def _project_task_state(row: KnowledgeTaskOutbox) -> KnowledgeTaskState:
    return KnowledgeTaskState(
        id=row.id,
        status=KnowledgeTaskStatus(row.status),
        last_error=row.last_error,
        payload=dict(row.payload),
    )


def get_latest_document_index_state_tasks(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_generations: Mapping[str, str],
) -> dict[str, DocumentIndexStateTaskProjection]:
    """Project the shared exact-generation state reader into application values."""
    return {
        document_id: DocumentIndexStateTaskProjection(
            action=DocumentIndexStateAction(row.payload["action"]),
            status=KnowledgeTaskStatus(row.status),
            last_error=row.last_error,
        )
        for document_id, row in get_current_document_index_state_rows(
            session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_generations=document_generations,
        ).items()
    }


class SQLAlchemyKnowledgeTaskStore:
    def __init__(self, *, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    def claim_pending(
        self,
        *,
        now: datetime,
        lease_expired_before: datetime,
        dispatched_expired_before: datetime,
        limit: int,
    ) -> tuple[KnowledgeTaskIntent, ...]:
        if limit < 1:
            return ()
        with self._session_factory() as session, session.begin():
            rows = session.scalars(
                select(KnowledgeTaskOutbox)
                .where(
                    or_(
                        and_(
                            KnowledgeTaskOutbox.status == "pending",
                            KnowledgeTaskOutbox.available_at <= now,
                        ),
                        and_(
                            KnowledgeTaskOutbox.status == "processing",
                            KnowledgeTaskOutbox.claimed_at <= lease_expired_before,
                        ),
                        and_(
                            KnowledgeTaskOutbox.status == "dispatched",
                            KnowledgeTaskOutbox.dispatched_at <= dispatched_expired_before,
                        ),
                        and_(
                            KnowledgeTaskOutbox.status == "executing",
                            KnowledgeTaskOutbox.available_at <= now,
                        ),
                    )
                )
                .order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            ).all()
            claimed: list[KnowledgeTaskIntent] = []
            for row in rows:
                recovered_execution = row.status == KnowledgeTaskStatus.EXECUTING
                if recovered_execution:
                    row.payload = {**row.payload, "_recovered_execution": True}
                claim_id = str(uuid4())
                row.status = "processing"
                row.claim_id = claim_id
                row.claimed_at = now
                row.dispatched_at = None
                row.attempts += 1
                row.last_error = None
                claimed.append(
                    KnowledgeTaskIntent(
                        id=row.id,
                        tenant_id=row.tenant_id,
                        dataset_id=row.dataset_id,
                        document_id=row.document_id,
                        resource_id=row.resource_id,
                        kind=KnowledgeTaskKind(row.task_kind),
                        payload=dict(row.payload),
                        attempts=row.attempts,
                        claim_id=claim_id,
                    )
                )
            return tuple(claimed)

    def mark_dispatched(self, *, intent_id: str, claim_id: str, dispatched_at: datetime) -> bool:
        with self._session_factory() as session, session.begin():
            result = session.execute(
                update(KnowledgeTaskOutbox)
                .where(
                    KnowledgeTaskOutbox.id == intent_id,
                    KnowledgeTaskOutbox.status == "processing",
                    KnowledgeTaskOutbox.claim_id == claim_id,
                )
                .values(
                    status="dispatched",
                    dispatched_at=dispatched_at,
                    claim_id=None,
                    claimed_at=None,
                    last_error=None,
                )
            )
            return bool(result.rowcount) if isinstance(result, CursorResult) else False

    def release_for_retry(
        self,
        *,
        intent_id: str,
        claim_id: str,
        available_at: datetime,
        error: str,
    ) -> bool:
        with self._session_factory() as session, session.begin():
            result = session.execute(
                update(KnowledgeTaskOutbox)
                .where(
                    KnowledgeTaskOutbox.id == intent_id,
                    KnowledgeTaskOutbox.status == "processing",
                    KnowledgeTaskOutbox.claim_id == claim_id,
                )
                .values(
                    status="pending",
                    available_at=available_at,
                    claim_id=None,
                    claimed_at=None,
                    last_error=error,
                )
            )
            return bool(result.rowcount) if isinstance(result, CursorResult) else False

    def begin_task_execution(self, *, intent_id: str, now: datetime, lease_until: datetime) -> str | None:
        """Claim one delivery without allowing active or terminal duplicates to run."""

        exhausted = False
        execution_id: str | None = None
        with self._session_factory() as session, session.begin():
            row = session.scalar(
                select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.id == intent_id).with_for_update()
            )
            if row is None or row.status == "completed":
                return None
            if row.status == "failed":
                if row.task_kind not in _CLEANUP_KINDS and row.execution_attempts >= _MAX_INDEX_EXECUTION_ATTEMPTS:
                    # A consumer may still need to persist its domain error
                    # after this terminal write. Re-delivery repeats only that
                    # notification; it never enters the task body again.
                    raise KnowledgeTaskRetriesExhaustedError(
                        row.last_error or f"Knowledge task {intent_id} exhausted its execution retry budget"
                    )
                return None
            if row.status in {"pending", "executing"} and row.available_at > now:
                return None
            if row.task_kind not in _CLEANUP_KINDS and row.execution_attempts >= _MAX_INDEX_EXECUTION_ATTEMPTS:
                row.status = "failed"
                row.claim_id = None
                row.claimed_at = None
                row.last_error = row.last_error or "Execution retry budget exhausted"
                exhausted = True
            else:
                if row.status == KnowledgeTaskStatus.EXECUTING:
                    row.payload = {**row.payload, "_recovered_execution": True}
                execution_id = str(uuid4())
                row.status = "executing"
                row.claim_id = execution_id
                row.claimed_at = now
                row.available_at = lease_until
                row.execution_attempts += 1
        if exhausted:
            raise KnowledgeTaskRetriesExhaustedError(f"Knowledge task {intent_id} exhausted its execution retry budget")
        return execution_id

    def is_recovered_task_execution(self, *, intent_id: str, execution_id: str) -> bool:
        with self._session_factory() as session:
            return bool(
                session.scalar(
                    select(KnowledgeTaskOutbox.id).where(
                        KnowledgeTaskOutbox.id == intent_id,
                        KnowledgeTaskOutbox.status == KnowledgeTaskStatus.EXECUTING,
                        KnowledgeTaskOutbox.claim_id == execution_id,
                        KnowledgeTaskOutbox.payload["_recovered_execution"].as_boolean().is_(True),
                    )
                )
            )

    def defer_task_execution(
        self,
        *,
        intent_id: str,
        execution_id: str,
        available_at: datetime,
        error: str,
    ) -> bool:
        """Return an active cleanup execution to pending without spending its execution budget."""

        with self._session_factory() as session, session.begin():
            row = session.scalar(
                select(KnowledgeTaskOutbox)
                .where(
                    KnowledgeTaskOutbox.id == intent_id,
                    KnowledgeTaskOutbox.status == KnowledgeTaskStatus.EXECUTING,
                    KnowledgeTaskOutbox.claim_id == execution_id,
                )
                .with_for_update()
            )
            if row is None:
                return False
            row.status = KnowledgeTaskStatus.PENDING
            row.available_at = available_at
            row.claim_id = None
            row.claimed_at = None
            row.dispatched_at = None
            row.last_error = error[:4000]
            row.execution_attempts = max(0, row.execution_attempts - 1)
            return True

    def defer_task_delivery(self, *, intent_id: str, available_at: datetime, error: str) -> bool:
        """Defer resource-lock contention before an execution attempt starts.

        A fast consumer can arrive before the publisher records ``dispatched``.
        Both publication states may be deferred, but an executing delivery or a
        terminal intent must never be reopened by another consumer.
        """

        with self._session_factory() as session, session.begin():
            result = session.execute(
                update(KnowledgeTaskOutbox)
                .where(
                    KnowledgeTaskOutbox.id == intent_id,
                    KnowledgeTaskOutbox.status.in_(("processing", "dispatched")),
                )
                .values(
                    status="pending",
                    available_at=available_at,
                    claim_id=None,
                    claimed_at=None,
                    dispatched_at=None,
                    last_error=error[:4000],
                )
            )
            return bool(result.rowcount) if isinstance(result, CursorResult) else False

    def renew_task_execution(self, *, intent_id: str, execution_id: str, now: datetime, lease_until: datetime) -> bool:
        with self._session_factory() as session, session.begin():
            result = session.execute(
                update(KnowledgeTaskOutbox)
                .where(
                    KnowledgeTaskOutbox.id == intent_id,
                    KnowledgeTaskOutbox.status == "executing",
                    KnowledgeTaskOutbox.claim_id == execution_id,
                    KnowledgeTaskOutbox.available_at > now,
                )
                .values(claimed_at=now, available_at=lease_until)
            )
            return bool(result.rowcount) if isinstance(result, CursorResult) else False

    def mark_task_completed(self, *, intent_id: str, execution_id: str) -> bool:
        """Record execution completion before acknowledging an outbox delivery."""

        with self._session_factory() as session, session.begin():
            result = session.execute(
                update(KnowledgeTaskOutbox)
                .where(
                    KnowledgeTaskOutbox.id == intent_id,
                    KnowledgeTaskOutbox.status == "executing",
                    KnowledgeTaskOutbox.claim_id == execution_id,
                )
                .values(
                    status="completed",
                    claim_id=None,
                    claimed_at=None,
                    last_error=None,
                )
            )
            if isinstance(result, CursorResult) and result.rowcount:
                return True
            return (
                session.scalar(
                    select(KnowledgeTaskOutbox.id).where(
                        KnowledgeTaskOutbox.id == intent_id, KnowledgeTaskOutbox.status == "completed"
                    )
                )
                is not None
            )

    def requeue_task_failure(
        self,
        *,
        intent_id: str,
        execution_id: str,
        available_at: datetime,
        error: str,
    ) -> KnowledgeTaskFailureDisposition:
        """Return an intent to the durable dispatcher after consumer failure.

        Only the matching execution claim may reopen an intent. Publication
        attempts do not consume the execution retry budget, and a superseded
        worker cannot overwrite its successor's state.
        """

        with self._session_factory() as session, session.begin():
            row = session.scalar(
                select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.id == intent_id).with_for_update()
            )
            if row is None:
                return KnowledgeTaskFailureDisposition.MISSING
            if row.status == "completed":
                return KnowledgeTaskFailureDisposition.COMPLETED
            if row.status == "failed":
                return KnowledgeTaskFailureDisposition.FAILED
            if row.status != "executing" or row.claim_id != execution_id:
                return KnowledgeTaskFailureDisposition.MISSING
            row.claim_id = None
            row.claimed_at = None
            row.dispatched_at = None
            row.last_error = error[:4000]
            if row.task_kind not in _CLEANUP_KINDS and row.execution_attempts >= _MAX_INDEX_EXECUTION_ATTEMPTS:
                row.status = "failed"
                return KnowledgeTaskFailureDisposition.FAILED
            row.status = "pending"
            delay = min(900, 5 * 2 ** min(max(row.execution_attempts - 1, 0), 8))
            row.available_at = available_at + timedelta(seconds=delay - 5)
            return KnowledgeTaskFailureDisposition.REQUEUED

    def mark_task_failed(self, *, intent_id: str, execution_id: str, error: str) -> bool:
        """Keep permanently inapplicable deliveries out of the dispatch loop."""

        with self._session_factory() as session, session.begin():
            result = session.execute(
                update(KnowledgeTaskOutbox)
                .where(
                    KnowledgeTaskOutbox.id == intent_id,
                    KnowledgeTaskOutbox.status == "executing",
                    KnowledgeTaskOutbox.claim_id == execution_id,
                )
                .values(status="failed", claim_id=None, claimed_at=None, last_error=error[:4000])
            )
            if isinstance(result, CursorResult) and result.rowcount:
                return True
            return (
                session.scalar(
                    select(KnowledgeTaskOutbox.id).where(
                        KnowledgeTaskOutbox.id == intent_id,
                        KnowledgeTaskOutbox.status == "completed",
                    )
                )
                is not None
            )
