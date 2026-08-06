from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any, Protocol

from graphon.enums import WorkflowExecutionStatus
from models.enums import CreatorUserRole
from models.workflow_handoff import (
    RagPipelineHandoffGroupMetadata,
    WorkflowHandoffResumeRoute,
    WorkflowHandoffSnapshotGC,
    WorkflowRunHandoff,
)


class WorkflowHandoffPreparationCancelledError(RuntimeError):
    """Raised when a durable Stop fences checkpoint preparation."""


class WorkflowHandoffTerminalOwnershipError(RuntimeError):
    """Raised when a runtime terminal write no longer owns the resumed run."""


class WorkflowHandoffSnapshotDeleteOutcome(StrEnum):
    DELETED = "deleted"
    MISSING = "missing"
    ALREADY_DELETED = "already_deleted"
    BLOCKED = "blocked"


@dataclass(frozen=True)
class WorkflowHandoffTerminalEvent:
    handoff_id: str
    generation: int
    task_id: str
    resume_route: WorkflowHandoffResumeRoute
    workflow_run_id: str
    workflow_id: str
    status: WorkflowExecutionStatus
    outputs: Mapping[str, Any]
    error: str | None
    elapsed_time: float
    total_tokens: int
    total_steps: int
    created_at: datetime
    finished_at: datetime | None
    exceptions_count: int
    handoff_duration: float
    message_id: str | None = None
    message_answer: str | None = None
    message_metadata: Mapping[str, Any] | None = None
    message_files: Sequence[Mapping[str, Any]] = ()


@dataclass(frozen=True)
class WorkflowHandoffTerminalScope:
    """Immutable ownership fence for terminalizing one resumed generation."""

    workflow_run_id: str
    task_id: str
    tenant_id: str
    app_id: str
    workflow_id: str
    resume_route: WorkflowHandoffResumeRoute


class WorkflowRunHandoffRepository(Protocol):
    """Persistence boundary for durable workflow checkpoint handoffs."""

    def create_preparing(
        self,
        *,
        workflow_run_id: str,
        task_id: str,
        snapshot_object_key: str,
        snapshot_schema_version: str,
        snapshot_checksum: str,
        snapshot_size_bytes: int,
        resume_route: WorkflowHandoffResumeRoute,
        source_worker_id: str,
        rag_group_metadata: RagPipelineHandoffGroupMetadata | None = None,
    ) -> WorkflowRunHandoff:
        """Commit an upload intent before object storage is touched."""
        ...

    def finish_preparing(
        self,
        *,
        handoff_id: str,
        generation: int,
    ) -> WorkflowRunHandoff | None:
        """Transition PREPARING to PREPARED unless a durable Stop won."""
        ...

    def create_prepared(
        self,
        *,
        workflow_run_id: str,
        task_id: str,
        snapshot_object_key: str,
        snapshot_schema_version: str,
        snapshot_checksum: str,
        snapshot_size_bytes: int,
        resume_route: WorkflowHandoffResumeRoute,
        source_worker_id: str,
        rag_group_metadata: RagPipelineHandoffGroupMetadata | None = None,
    ) -> WorkflowRunHandoff:
        """Create a checkpoint that remains undispatchable until explicitly activated."""
        ...

    def activate_latest_prepared_by_task_id(
        self,
        *,
        task_id: str,
        activated_at: datetime,
    ) -> WorkflowRunHandoff | None:
        """Atomically activate the latest PREPARED checkpoint for a task."""
        ...

    def get(self, handoff_id: str, generation: int | None = None) -> WorkflowRunHandoff | None: ...

    def get_latest_by_run(self, workflow_run_id: str) -> WorkflowRunHandoff | None: ...

    def list_due(
        self,
        *,
        now: datetime,
        redispatch_interval: timedelta,
        max_attempts: int,
        limit: int,
    ) -> Sequence[WorkflowRunHandoff]:
        """List durable outbox rows that should be dispatched or redispatched."""
        ...

    def mark_dispatched(self, *, handoff_id: str, generation: int, dispatched_at: datetime) -> bool: ...

    def claim(
        self,
        *,
        handoff_id: str,
        generation: int,
        lease_owner: str,
        lease_duration: timedelta,
        max_attempts: int,
        now: datetime,
    ) -> WorkflowRunHandoff | None:
        """Atomically claim a due handoff or reclaim an expired lease."""
        ...

    def renew_lease(
        self,
        *,
        handoff_id: str,
        generation: int,
        lease_owner: str,
        lease_token: str,
        lease_duration: timedelta,
        now: datetime,
    ) -> bool: ...

    def record_failure(
        self,
        *,
        handoff_id: str,
        generation: int,
        lease_owner: str,
        lease_token: str,
        error: str,
        retry_at: datetime,
        max_attempts: int,
        now: datetime,
    ) -> WorkflowRunHandoff | None:
        """Release a claim for retry, or fail it when the retry budget is exhausted."""
        ...

    def mark_resumed(
        self,
        *,
        handoff_id: str,
        generation: int,
        lease_owner: str,
        lease_token: str,
        resumed_at: datetime,
    ) -> bool: ...

    def mark_failed(
        self,
        *,
        handoff_id: str,
        generation: int,
        error: str,
        failed_at: datetime,
        lease_owner: str | None = None,
        lease_token: str | None = None,
    ) -> bool: ...

    def request_cancel(
        self,
        *,
        workflow_run_id: str,
        requested_at: datetime,
        reason: str = "workflow run cancellation requested",
    ) -> int:
        """Cancel active durable handoffs and stop the parent run in the same transaction."""
        ...

    def request_cancel_by_task_id(
        self,
        *,
        task_id: str,
        requested_at: datetime,
        reason: str = "workflow task cancellation requested",
        scope_tenant_id: str | None = None,
        scope_app_id: str | None = None,
        scope_created_by_role: CreatorUserRole | None = None,
        scope_created_by: str | None = None,
        expires_at: datetime | None = None,
    ) -> int:
        """Record Stop and cancel scoped PREPARING/PREPARED/READY/CLAIMED rows.

        Omitting owner scope is reserved for trusted internal call sites. A
        latest RESUMED row is left to the live graph's Abort command.
        """
        ...

    def fail_exhausted(self, *, now: datetime, max_attempts: int, error: str) -> int:
        """Fail exhausted READY rows and exhausted CLAIMED rows whose lease expired."""
        ...

    def fail_stale_prepared(self, *, now: datetime, stale_before: datetime, error: str, limit: int) -> int:
        """Fail stale PREPARED rows and conditionally stop their still-running runs."""
        ...

    def fail_stale_ready(self, *, now: datetime, stale_before: datetime, error: str, limit: int) -> int:
        """Fail latest READY rows that never reached a first resume claim."""
        ...

    def list_failed_pending_terminal_compensation(self, *, limit: int) -> Sequence[WorkflowRunHandoff]:
        """List FAILED handoffs whose route-specific terminal state is not reconciled."""
        ...

    def compensate_failed_terminal(self, *, handoff_id: str, generation: int, compensated_at: datetime) -> bool:
        """Idempotently reconcile WorkflowRun and route-specific terminal records."""
        ...

    def reconcile_resumed_terminal_failure(
        self,
        *,
        handoff_id: str,
        generation: int,
        scope: WorkflowHandoffTerminalScope,
        error: str,
        failed_at: datetime,
        message_answer_delta: str = "",
        message_answer_replacement: str | None = None,
    ) -> WorkflowHandoffTerminalEvent | None:
        """Atomically terminalize an owned, latest RESUMED generation.

        A terminal event is returned only after the durable business records
        and terminal outbox marker have committed. ``None`` means that an
        already-published event or the durable PAUSED reconnect snapshot owns
        delivery. Ownership mismatches are raised instead of falling back to an
        unscoped write.
        """
        ...

    def list_pending_terminal_events(self, *, limit: int) -> Sequence[WorkflowHandoffTerminalEvent]:
        """Build durable terminal events that still need at-least-once publication."""
        ...

    def mark_terminal_event_published(self, *, handoff_id: str, generation: int, published_at: datetime) -> bool: ...

    def record_terminal_processing_failure(self, *, handoff_id: str, generation: int, error: str) -> bool: ...

    def list_snapshot_gc_candidates(self, *, now: datetime, limit: int) -> Sequence[WorkflowHandoffSnapshotGC]:
        """List snapshot keys that may be checked for guarded deletion."""
        ...

    def delete_snapshot_if_unreferenced(
        self,
        *,
        snapshot_object_key: str,
        deleted_at: datetime,
        delete_object: Callable[[str], bool],
    ) -> WorkflowHandoffSnapshotDeleteOutcome:
        """Delete while serializing against new active references to the same key."""
        ...

    def record_snapshot_gc_failure(self, *, snapshot_object_key: str, error: str, retry_at: datetime) -> bool: ...

    def cleanup_expired_cancellations(self, *, now: datetime, limit: int) -> int: ...

    def cleanup_terminal_handoffs(self, *, terminal_before: datetime, limit: int) -> int:
        """Delete bounded, fully reconciled terminal audit rows older than the cutoff."""
        ...

    def cleanup_completed_snapshot_gc(self, *, deleted_before: datetime, limit: int) -> int:
        """Delete bounded, aged GC outbox rows after every handoff reference is gone."""
        ...


__all__ = [
    "WorkflowHandoffPreparationCancelledError",
    "WorkflowHandoffSnapshotDeleteOutcome",
    "WorkflowHandoffTerminalEvent",
    "WorkflowHandoffTerminalOwnershipError",
    "WorkflowHandoffTerminalScope",
    "WorkflowRunHandoffRepository",
]
