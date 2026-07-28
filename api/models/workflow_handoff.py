from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from models.enums import CreatorUserRole

from .base import DefaultFieldsDCMixin, TypeBase
from .types import EnumText, LongText, StringUUID

RAG_PIPELINE_SOURCE_BATCH_ID_EXTRA_KEY = "source_batch_id"
RAG_PIPELINE_TENANT_ID_EXTRA_KEY = "tenant_id"
RAG_PIPELINE_QUEUE_KIND_EXTRA_KEY = "queue_kind"
RAG_PIPELINE_TENANT_ISOLATED_EXTRA_KEY = "tenant_isolated"


class WorkflowHandoffState(StrEnum):
    """Durable states for transferring a workflow execution between workers."""

    PREPARING = "preparing"
    PREPARED = "prepared"
    READY = "ready"
    CLAIMED = "claimed"
    RESUMED = "resumed"
    FAILED = "failed"


class WorkflowHandoffResumeRoute(StrEnum):
    """Execution entry point that must rebuild the workflow from a checkpoint."""

    WORKFLOW = "workflow"
    SNIPPET = "snippet"
    ADVANCED_CHAT = "advanced_chat"
    TRIGGERED_WORKFLOW = "triggered_workflow"
    RAG_PIPELINE = "rag_pipeline"


class RagPipelineQueueKind(StrEnum):
    """Celery lane owning a RAG pipeline source batch."""

    REGULAR = "regular"
    PRIORITY = "priority"


@dataclass(frozen=True)
class RagPipelineHandoffGroupIdentity:
    source_batch_id: str
    tenant_id: str
    queue_kind: RagPipelineQueueKind


@dataclass(frozen=True)
class RagPipelineHandoffGroupMetadata:
    """Durable tenant-slot ownership carried by a RAG handoff checkpoint."""

    source_batch_id: str
    tenant_id: str
    queue_kind: RagPipelineQueueKind
    dataset_id: str
    document_id: str | None
    tenant_isolated: bool

    @property
    def identity(self) -> RagPipelineHandoffGroupIdentity:
        return RagPipelineHandoffGroupIdentity(
            source_batch_id=self.source_batch_id,
            tenant_id=self.tenant_id,
            queue_kind=self.queue_kind,
        )


class WorkflowRunHandoff(DefaultFieldsDCMixin, TypeBase):
    """A durable checkpoint handoff created during a planned worker drain.

    A workflow run may be handed off multiple times. ``generation`` fences commands
    and resume attempts from older handoffs, while ``lease_token`` fences retries of
    the same generation after a lease expires. The checkpoint object is written to
    shared storage before this row transitions into ``READY``.
    """

    __tablename__ = "workflow_run_handoffs"
    __table_args__ = (
        UniqueConstraint(
            "workflow_run_id",
            "generation",
            name="workflow_run_handoffs_run_generation_key",
        ),
        sa.CheckConstraint("generation > 0", name="generation_positive"),
        sa.CheckConstraint("attempts >= 0", name="attempts_nonnegative"),
        sa.CheckConstraint("terminal_attempts >= 0", name="terminal_attempts_nonnegative"),
        sa.CheckConstraint("snapshot_size_bytes >= 0", name="snapshot_size_nonnegative"),
        sa.CheckConstraint(
            "state IN ('preparing', 'prepared', 'ready', 'claimed', 'resumed', 'failed')",
            name="state_valid",
        ),
        sa.CheckConstraint(
            "resume_route IN ('workflow', 'snippet', 'advanced_chat', 'triggered_workflow', 'rag_pipeline')",
            name="resume_route_valid",
        ),
        sa.CheckConstraint(
            "state <> 'claimed' OR "
            "(lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)",
            name="claim_lease_present",
        ),
        sa.CheckConstraint(
            "state <> 'resumed' OR resumed_at IS NOT NULL",
            name="resumed_at_present",
        ),
        sa.CheckConstraint(
            "state <> 'failed' OR failed_at IS NOT NULL",
            name="failed_at_present",
        ),
        sa.CheckConstraint(
            "(rag_source_batch_id IS NULL AND rag_tenant_id IS NULL AND rag_queue_kind IS NULL "
            "AND rag_dataset_id IS NULL AND rag_tenant_isolated IS NULL) OR "
            "(rag_source_batch_id IS NOT NULL AND rag_tenant_id IS NOT NULL AND rag_queue_kind IS NOT NULL "
            "AND rag_dataset_id IS NOT NULL AND rag_tenant_isolated IS NOT NULL)",
            name="rag_group_metadata_complete",
        ),
        sa.CheckConstraint(
            "rag_queue_kind IS NULL OR rag_queue_kind IN ('regular', 'priority')",
            name="rag_queue_kind_valid",
        ),
        sa.CheckConstraint(
            "rag_tenant_slot_released_at IS NULL OR rag_group_sealed_at IS NOT NULL",
            name="rag_release_requires_seal",
        ),
        Index("workflow_run_handoffs_run_state_idx", "workflow_run_id", "state"),
        Index("workflow_run_handoffs_snapshot_object_key_idx", "snapshot_object_key"),
        Index("workflow_run_handoffs_task_state_idx", "task_id", "state"),
        Index("workflow_run_handoffs_state_created_idx", "state", "created_at", "id"),
        Index("workflow_run_handoffs_resumed_retention_idx", "state", "resumed_at", "id"),
        Index("workflow_run_handoffs_failed_retention_idx", "state", "failed_at", "id"),
        Index(
            "workflow_run_handoffs_terminal_idx",
            "state",
            "terminal_compensated_at",
            "terminal_event_published_at",
            "created_at",
        ),
        Index(
            "workflow_run_handoffs_rag_group_release_idx",
            "rag_source_batch_id",
            "rag_tenant_id",
            "rag_queue_kind",
            "rag_group_sealed_at",
            "rag_tenant_slot_released_at",
        ),
        Index(
            "workflow_run_handoffs_rag_reconcile_idx",
            "rag_group_sealed_at",
            "rag_tenant_slot_released_at",
            "rag_source_batch_id",
        ),
        Index(
            "workflow_run_handoffs_dispatch_idx",
            "state",
            "next_retry_at",
            "lease_expires_at",
            "dispatched_at",
            "created_at",
        ),
    )

    workflow_run_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    generation: Mapped[int] = mapped_column(Integer, nullable=False)
    task_id: Mapped[str] = mapped_column(String(255), nullable=False)

    snapshot_object_key: Mapped[str] = mapped_column(String(255), nullable=False)
    snapshot_schema_version: Mapped[str] = mapped_column(String(64), nullable=False)
    snapshot_checksum: Mapped[str] = mapped_column(String(128), nullable=False)
    snapshot_size_bytes: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)

    resume_route: Mapped[WorkflowHandoffResumeRoute] = mapped_column(
        EnumText(WorkflowHandoffResumeRoute, length=64),
        nullable=False,
    )
    source_worker_id: Mapped[str] = mapped_column(String(255), nullable=False)

    rag_source_batch_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    rag_tenant_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    rag_queue_kind: Mapped[RagPipelineQueueKind | None] = mapped_column(
        EnumText(RagPipelineQueueKind, length=32), nullable=True, default=None
    )
    rag_dataset_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    rag_document_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    rag_tenant_isolated: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=None)
    rag_group_sealed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    rag_tenant_slot_released_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    rag_document_error_marked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    state: Mapped[WorkflowHandoffState] = mapped_column(
        EnumText(WorkflowHandoffState, length=32),
        nullable=False,
        default=WorkflowHandoffState.PREPARED,
        server_default=sa.text("'prepared'"),
    )
    target_worker_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    lease_owner: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    lease_token: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    last_error: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    resumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    terminal_compensated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    terminal_event_published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    terminal_attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )
    terminal_last_error: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)


class WorkflowHandoffSnapshotGC(DefaultFieldsDCMixin, TypeBase):
    """Durable object-GC reference independent of WorkflowRun retention.

    The row is created in the PREPARING intent transaction, before object
    storage is touched. It therefore remains the last durable reference even
    when a workflow run and its operational handoff rows are later removed.
    """

    __tablename__ = "workflow_handoff_snapshot_gc"
    __table_args__ = (
        UniqueConstraint(
            "snapshot_object_key",
            name="workflow_handoff_snapshot_gc_object_key_key",
        ),
        sa.CheckConstraint("attempts >= 0", name="attempts_nonnegative"),
        Index(
            "workflow_handoff_snapshot_gc_pending_idx",
            "deleted_at",
            "next_retry_at",
            "created_at",
        ),
    )

    snapshot_object_key: Mapped[str] = mapped_column(String(255), nullable=False)
    upload_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=sa.text("0"),
    )
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    last_error: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)


class WorkflowHandoffCancellation(DefaultFieldsDCMixin, TypeBase):
    """Durable Stop tombstone fencing handoff preparation by task and owner scope.

    A Stop request can arrive after GraphEngine accepts a maintenance pause but
    before the checkpoint row exists. This tombstone is committed independently
    of object storage so a later preparation transaction can observe the Stop
    and terminalize the parent run instead of reviving it.

    ``scope_tenant_id``/``scope_app_id`` are nullable only for trusted internal
    cancellation paths. Public paths should persist the authorized owner scope.
    """

    __tablename__ = "workflow_handoff_cancellations"
    __table_args__ = (
        sa.CheckConstraint(
            "(scope_tenant_id IS NULL AND scope_app_id IS NULL) OR "
            "(scope_tenant_id IS NOT NULL AND scope_app_id IS NOT NULL)",
            name="owner_scope_pair",
        ),
        sa.CheckConstraint(
            "(scope_created_by_role IS NULL AND scope_created_by IS NULL) OR "
            "(scope_created_by_role IS NOT NULL AND scope_created_by IS NOT NULL)",
            name="creator_scope_pair",
        ),
        sa.CheckConstraint(
            "scope_created_by IS NULL OR (scope_tenant_id IS NOT NULL AND scope_app_id IS NOT NULL)",
            name="creator_scope_app",
        ),
        Index(
            "workflow_handoff_cancellations_task_scope_idx",
            "task_id",
            "scope_tenant_id",
            "scope_app_id",
            "scope_created_by_role",
            "scope_created_by",
            "expires_at",
        ),
        Index("workflow_handoff_cancellations_expires_idx", "expires_at"),
    )

    task_id: Mapped[str] = mapped_column(String(255), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    reason: Mapped[str] = mapped_column(LongText, nullable=False)
    scope_tenant_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    scope_app_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    scope_created_by_role: Mapped[CreatorUserRole | None] = mapped_column(
        EnumText(CreatorUserRole, length=255), nullable=True, default=None
    )
    scope_created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)


__all__ = [
    "RAG_PIPELINE_QUEUE_KIND_EXTRA_KEY",
    "RAG_PIPELINE_SOURCE_BATCH_ID_EXTRA_KEY",
    "RAG_PIPELINE_TENANT_ID_EXTRA_KEY",
    "RAG_PIPELINE_TENANT_ISOLATED_EXTRA_KEY",
    "RagPipelineHandoffGroupIdentity",
    "RagPipelineHandoffGroupMetadata",
    "RagPipelineQueueKind",
    "WorkflowHandoffCancellation",
    "WorkflowHandoffResumeRoute",
    "WorkflowHandoffSnapshotGC",
    "WorkflowHandoffState",
    "WorkflowRunHandoff",
]
