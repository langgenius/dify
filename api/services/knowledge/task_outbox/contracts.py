"""Framework-neutral contracts for durable knowledge tasks."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Protocol


class KnowledgeTaskKind(StrEnum):
    DOCUMENT_CLEANUP = "document_cleanup"
    DOCUMENT_BATCH_CLEANUP = "document_batch_cleanup"
    FILE_CLEANUP = "file_cleanup"
    DELETION_INDEX_CLEANUP = "deletion_index_cleanup"
    DOCUMENT_INDEX_CREATE = "document_index_create"
    DOCUMENT_INDEX_DUPLICATE = "document_index_duplicate"
    DOCUMENT_INDEX_RETRY = "document_index_retry"
    DOCUMENT_INDEX_UPDATE = "document_index_update"
    DOCUMENT_INDEX_STATE = "document_index_state"
    DOCUMENT_INDEX_RECOVER = "document_index_recover"
    DOCUMENT_INDEX_SYNC = "document_index_sync"
    DOCUMENT_SUMMARY_INDEX = "document_summary_index"
    DATASET_CLEANUP = "dataset_cleanup"
    DATASET_VECTOR_INDEX_UPDATE = "dataset_vector_index_update"
    DATASET_SUMMARY_INDEX_REGENERATE = "dataset_summary_index_regenerate"
    SEGMENT_INDEX_ENABLE = "segment_index_enable"
    SEGMENT_INDEX_DISABLE = "segment_index_disable"
    SEGMENT_INDEX_CREATE = "segment_index_create"
    SEGMENT_INDEX_RECONCILE = "segment_index_reconcile"
    SEGMENT_DELETE_CLEANUP = "segment_delete_cleanup"


class KnowledgeTaskDeliveryHandledError(RuntimeError):
    """The durable owner recorded this delivery; Celery must not retry it."""


class KnowledgeTaskRequeuedError(KnowledgeTaskDeliveryHandledError):
    """Execution was durably requeued and must not use Celery autoretry."""


class KnowledgeTaskExecutionDeferredError(KnowledgeTaskRequeuedError):
    """The active execution returned to pending without spending its retry budget."""


class KnowledgeTaskPermanentError(KnowledgeTaskDeliveryHandledError):
    """The desired operation cannot execute in the resource's current state."""


class KnowledgeTaskRetriesExhaustedError(KnowledgeTaskDeliveryHandledError):
    """An indexing intent exhausted its durable execution retry budget."""


class KnowledgeTaskExecutionLeaseLostError(KnowledgeTaskDeliveryHandledError):
    """This delivery no longer owns the durable execution lease."""


class KnowledgeTaskFailureDisposition(StrEnum):
    REQUEUED = "requeued"
    COMPLETED = "completed"
    MISSING = "missing"
    FAILED = "failed"


class KnowledgeTaskStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    DISPATCHED = "dispatched"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"


class DocumentIndexStateAction(StrEnum):
    ADD = "add"
    REMOVE = "remove"


@dataclass(frozen=True)
class KnowledgeTaskState:
    id: str
    status: KnowledgeTaskStatus
    last_error: str | None
    payload: dict[str, object]


@dataclass(frozen=True)
class DocumentIndexStateTaskProjection:
    action: DocumentIndexStateAction
    status: KnowledgeTaskStatus
    last_error: str | None


@dataclass(frozen=True)
class KnowledgeTaskIntent:
    id: str
    tenant_id: str
    dataset_id: str
    document_id: str | None
    resource_id: str | None
    kind: KnowledgeTaskKind
    payload: dict[str, object]
    attempts: int
    claim_id: str


class KnowledgeTaskStore(Protocol):
    def begin_task_execution(self, *, intent_id: str, now: datetime, lease_until: datetime) -> str | None: ...

    def renew_task_execution(
        self, *, intent_id: str, execution_id: str, now: datetime, lease_until: datetime
    ) -> bool: ...

    def is_recovered_task_execution(self, *, intent_id: str, execution_id: str) -> bool: ...

    def defer_task_execution(
        self,
        *,
        intent_id: str,
        execution_id: str,
        available_at: datetime,
        error: str,
    ) -> bool: ...

    def claim_pending(
        self,
        *,
        now: datetime,
        lease_expired_before: datetime,
        dispatched_expired_before: datetime,
        limit: int,
    ) -> tuple[KnowledgeTaskIntent, ...]: ...

    def mark_dispatched(self, *, intent_id: str, claim_id: str, dispatched_at: datetime) -> bool: ...

    def release_for_retry(
        self,
        *,
        intent_id: str,
        claim_id: str,
        available_at: datetime,
        error: str,
    ) -> bool: ...

    def mark_task_completed(self, *, intent_id: str, execution_id: str) -> bool: ...

    def mark_task_failed(self, *, intent_id: str, execution_id: str, error: str) -> bool: ...

    def requeue_task_failure(
        self,
        *,
        intent_id: str,
        execution_id: str,
        available_at: datetime,
        error: str,
    ) -> KnowledgeTaskFailureDisposition: ...


class KnowledgeTaskPublisher(Protocol):
    def publish(self, intent: KnowledgeTaskIntent) -> None: ...
