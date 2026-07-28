from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timedelta
from typing import Any, cast, override

from sqlalchemy import and_, case, delete, exists, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import InstrumentedAttribute, Session, sessionmaker
from sqlalchemy.sql import ColumnElement

from core.app.task_pipeline.message_file_utils import prepare_file_dict
from graphon.enums import WorkflowExecutionStatus
from graphon.file import FileTransferMethod
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.dataset import Document
from models.enums import CreatorUserRole, IndexingStatus, MessageStatus, WorkflowTriggerStatus
from models.model import Message, MessageFile, UploadFile
from models.trigger import WorkflowTriggerLog
from models.workflow import WorkflowRun
from models.workflow_handoff import (
    RagPipelineHandoffGroupMetadata,
    WorkflowHandoffCancellation,
    WorkflowHandoffResumeRoute,
    WorkflowHandoffSnapshotGC,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)
from repositories.workflow_handoff_repository import (
    WorkflowHandoffPreparationCancelledError,
    WorkflowHandoffSnapshotDeleteOutcome,
    WorkflowHandoffTerminalEvent,
    WorkflowHandoffTerminalOwnershipError,
    WorkflowHandoffTerminalScope,
    WorkflowRunHandoffRepository,
)


class WorkflowRunNotFoundForHandoffError(ValueError):
    pass


class ActiveWorkflowRunHandoffError(RuntimeError):
    pass


class WorkflowRunNotResumableForHandoffError(RuntimeError):
    pass


class SQLAlchemyWorkflowRunHandoffRepository(WorkflowRunHandoffRepository):
    """SQLAlchemy implementation of the durable workflow handoff state machine.

    Storage writes are intentionally absent from this repository. The caller must
    commit a PREPARING intent before uploading, then call ``finish_preparing``.
    Every state transition is committed in a bounded database transaction.
    """

    _ACTIVE_HANDOFF_STATES = (
        WorkflowHandoffState.PREPARING,
        WorkflowHandoffState.PREPARED,
        WorkflowHandoffState.READY,
        WorkflowHandoffState.CLAIMED,
    )

    def __init__(self, session_factory: sessionmaker[Session]):
        self._session_factory = session_factory

    @override
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
        """Compatibility helper for callers that already own durable bytes."""
        handoff = self.create_preparing(
            workflow_run_id=workflow_run_id,
            task_id=task_id,
            snapshot_object_key=snapshot_object_key,
            snapshot_schema_version=snapshot_schema_version,
            snapshot_checksum=snapshot_checksum,
            snapshot_size_bytes=snapshot_size_bytes,
            resume_route=resume_route,
            source_worker_id=source_worker_id,
            rag_group_metadata=rag_group_metadata,
        )
        if handoff.state == WorkflowHandoffState.FAILED:
            raise WorkflowHandoffPreparationCancelledError(
                f"Workflow handoff preparation was cancelled: handoff_id={handoff.id}"
            )
        if handoff.state != WorkflowHandoffState.PREPARING:
            return handoff
        prepared = self.finish_preparing(handoff_id=handoff.id, generation=handoff.generation)
        if prepared is None:
            raise WorkflowHandoffPreparationCancelledError(
                f"Workflow handoff preparation was cancelled: handoff_id={handoff.id}"
            )
        return prepared

    @override
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
        if snapshot_size_bytes < 0:
            raise ValueError("snapshot_size_bytes must be non-negative")
        if not task_id:
            raise ValueError("task_id must not be empty")
        if not snapshot_object_key or not snapshot_schema_version or not snapshot_checksum:
            raise ValueError("snapshot metadata must not be empty")
        if not source_worker_id:
            raise ValueError("source_worker_id must not be empty")

        with self._session_factory.begin() as session:
            # Locking the parent run serializes the first handoff as well as later
            # generations. Locking only existing handoff rows cannot protect the
            # empty-table case from allocating generation 1 twice.
            locked_run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == workflow_run_id).with_for_update())
            if locked_run is None:
                raise WorkflowRunNotFoundForHandoffError(f"WorkflowRun not found: {workflow_run_id}")
            if locked_run.status != WorkflowExecutionStatus.RUNNING:
                raise WorkflowRunNotResumableForHandoffError(
                    f"WorkflowRun is not running: workflow_run_id={workflow_run_id}, status={locked_run.status}"
                )

            latest_handoff = session.scalar(
                select(WorkflowRunHandoff)
                .where(WorkflowRunHandoff.workflow_run_id == workflow_run_id)
                .order_by(WorkflowRunHandoff.generation.desc())
                .limit(1)
                .with_for_update()
            )
            self._ensure_snapshot_gc_reference(
                session,
                snapshot_object_key=snapshot_object_key,
            )
            cancellation = self._get_matching_task_cancellation(
                session,
                task_id=task_id,
                workflow_run=locked_run,
            )
            if cancellation is not None:
                if (
                    latest_handoff is not None
                    and latest_handoff.task_id == task_id
                    and latest_handoff.state in self._ACTIVE_HANDOFF_STATES
                ):
                    self._cancel_locked_handoffs(
                        [latest_handoff],
                        requested_at=cancellation.requested_at,
                        reason=cancellation.reason,
                        workflow_runs_by_id={locked_run.id: locked_run},
                    )
                    handoff = latest_handoff
                else:
                    handoff = WorkflowRunHandoff(
                        workflow_run_id=workflow_run_id,
                        generation=(latest_handoff.generation if latest_handoff is not None else 0) + 1,
                        task_id=task_id,
                        snapshot_object_key=snapshot_object_key,
                        snapshot_schema_version=snapshot_schema_version,
                        snapshot_checksum=snapshot_checksum,
                        snapshot_size_bytes=snapshot_size_bytes,
                        resume_route=resume_route,
                        source_worker_id=source_worker_id,
                        rag_source_batch_id=rag_group_metadata.source_batch_id if rag_group_metadata else None,
                        rag_tenant_id=rag_group_metadata.tenant_id if rag_group_metadata else None,
                        rag_queue_kind=rag_group_metadata.queue_kind if rag_group_metadata else None,
                        rag_dataset_id=rag_group_metadata.dataset_id if rag_group_metadata else None,
                        rag_document_id=rag_group_metadata.document_id if rag_group_metadata else None,
                        rag_tenant_isolated=rag_group_metadata.tenant_isolated if rag_group_metadata else None,
                        state=WorkflowHandoffState.FAILED,
                        cancel_requested_at=cancellation.requested_at,
                        failed_at=cancellation.requested_at,
                        last_error=cancellation.reason,
                    )
                    session.add(handoff)
                self._stop_locked_workflow_run_if_running(
                    locked_run,
                    reason=cancellation.reason,
                    now=cancellation.requested_at,
                )
                return self._flush_and_detach(session, handoff)

            if latest_handoff is not None and latest_handoff.state in self._ACTIVE_HANDOFF_STATES:
                if self._has_same_checkpoint(
                    latest_handoff,
                    task_id=task_id,
                    snapshot_object_key=snapshot_object_key,
                    snapshot_schema_version=snapshot_schema_version,
                    snapshot_checksum=snapshot_checksum,
                    snapshot_size_bytes=snapshot_size_bytes,
                    resume_route=resume_route,
                    rag_group_metadata=rag_group_metadata,
                ):
                    return self._detach_required(session, latest_handoff)
                raise ActiveWorkflowRunHandoffError(f"WorkflowRun already has an active handoff: {latest_handoff.id}")

            handoff = WorkflowRunHandoff(
                workflow_run_id=workflow_run_id,
                generation=(latest_handoff.generation if latest_handoff is not None else 0) + 1,
                task_id=task_id,
                snapshot_object_key=snapshot_object_key,
                snapshot_schema_version=snapshot_schema_version,
                snapshot_checksum=snapshot_checksum,
                snapshot_size_bytes=snapshot_size_bytes,
                resume_route=resume_route,
                source_worker_id=source_worker_id,
                rag_source_batch_id=rag_group_metadata.source_batch_id if rag_group_metadata else None,
                rag_tenant_id=rag_group_metadata.tenant_id if rag_group_metadata else None,
                rag_queue_kind=rag_group_metadata.queue_kind if rag_group_metadata else None,
                rag_dataset_id=rag_group_metadata.dataset_id if rag_group_metadata else None,
                rag_document_id=rag_group_metadata.document_id if rag_group_metadata else None,
                rag_tenant_isolated=rag_group_metadata.tenant_isolated if rag_group_metadata else None,
                state=WorkflowHandoffState.PREPARING,
            )
            session.add(handoff)
            return self._flush_and_detach(session, handoff)

    @override
    def finish_preparing(
        self,
        *,
        handoff_id: str,
        generation: int,
    ) -> WorkflowRunHandoff | None:
        """Publish a completed upload without allowing Stop to revive it."""
        with self._session_factory.begin() as session:
            workflow_run_id = session.scalar(
                select(WorkflowRunHandoff.workflow_run_id).where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                )
            )
            if workflow_run_id is None:
                return None
            workflow_run = session.scalar(
                select(WorkflowRun).where(WorkflowRun.id == workflow_run_id).with_for_update()
            )
            handoff = session.scalar(
                select(WorkflowRunHandoff)
                .where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                )
                .with_for_update()
            )
            if handoff is None:
                return None
            self._mark_snapshot_upload_completed(
                session,
                snapshot_object_key=handoff.snapshot_object_key,
            )
            if handoff.state == WorkflowHandoffState.PREPARED and handoff.cancel_requested_at is None:
                return self._detach_required(session, handoff)
            if handoff.state != WorkflowHandoffState.PREPARING:
                return None

            cancellation = None
            if workflow_run is not None:
                cancellation = self._get_matching_task_cancellation(
                    session,
                    task_id=handoff.task_id,
                    workflow_run=workflow_run,
                )
            if cancellation is not None:
                assert workflow_run is not None
                self._cancel_locked_handoffs(
                    [handoff],
                    requested_at=cancellation.requested_at,
                    reason=cancellation.reason,
                    workflow_runs_by_id={workflow_run.id: workflow_run},
                )
                self._stop_locked_workflow_run_if_running(
                    workflow_run,
                    reason=cancellation.reason,
                    now=cancellation.requested_at,
                )
                session.flush()
                return None
            if (
                workflow_run is None
                or workflow_run.status != WorkflowExecutionStatus.RUNNING
                or handoff.cancel_requested_at is not None
            ):
                return None

            handoff.state = WorkflowHandoffState.PREPARED
            return self._flush_and_detach(session, handoff)

    @override
    def activate_latest_prepared_by_task_id(
        self,
        *,
        task_id: str,
        activated_at: datetime,
    ) -> WorkflowRunHandoff | None:
        if not task_id:
            raise ValueError("task_id must not be empty")

        with self._session_factory.begin() as session:
            candidate_run_id = session.scalar(
                select(WorkflowRunHandoff.workflow_run_id)
                .where(WorkflowRunHandoff.task_id == task_id)
                .order_by(
                    WorkflowRunHandoff.created_at.desc(),
                    WorkflowRunHandoff.generation.desc(),
                    WorkflowRunHandoff.id.desc(),
                )
                .limit(1)
            )
            if candidate_run_id is None:
                return None

            workflow_run = session.scalar(
                select(WorkflowRun).where(WorkflowRun.id == candidate_run_id).with_for_update()
            )
            if workflow_run is None or workflow_run.status != WorkflowExecutionStatus.RUNNING:
                return None

            latest_handoff = session.scalar(
                select(WorkflowRunHandoff)
                .where(WorkflowRunHandoff.workflow_run_id == candidate_run_id)
                .order_by(WorkflowRunHandoff.generation.desc())
                .limit(1)
                .with_for_update()
            )
            if (
                latest_handoff is None
                or latest_handoff.task_id != task_id
                or latest_handoff.state != WorkflowHandoffState.PREPARED
                or latest_handoff.cancel_requested_at is not None
            ):
                return None

            latest_handoff.state = WorkflowHandoffState.READY
            latest_handoff.next_retry_at = activated_at
            latest_handoff.dispatched_at = None
            return self._flush_and_detach(session, latest_handoff)

    @override
    def get(self, handoff_id: str, generation: int | None = None) -> WorkflowRunHandoff | None:
        with self._session_factory() as session:
            stmt = select(WorkflowRunHandoff).where(WorkflowRunHandoff.id == handoff_id)
            if generation is not None:
                stmt = stmt.where(WorkflowRunHandoff.generation == generation)
            handoff = session.scalar(stmt)
            return self._detach(session, handoff)

    @override
    def get_latest_by_run(self, workflow_run_id: str) -> WorkflowRunHandoff | None:
        with self._session_factory() as session:
            handoff = session.scalar(
                select(WorkflowRunHandoff)
                .where(WorkflowRunHandoff.workflow_run_id == workflow_run_id)
                .order_by(WorkflowRunHandoff.generation.desc())
                .limit(1)
            )
            return self._detach(session, handoff)

    @override
    def list_due(
        self,
        *,
        now: datetime,
        redispatch_interval: timedelta,
        max_attempts: int,
        limit: int,
    ) -> Sequence[WorkflowRunHandoff]:
        self._validate_positive(max_attempts=max_attempts, limit=limit)
        if redispatch_interval.total_seconds() < 0:
            raise ValueError("redispatch_interval must be non-negative")

        redispatch_before = now - redispatch_interval
        dispatch_is_due = or_(
            WorkflowRunHandoff.dispatched_at.is_(None),
            WorkflowRunHandoff.dispatched_at <= redispatch_before,
        )
        retry_is_due = or_(
            WorkflowRunHandoff.next_retry_at.is_(None),
            WorkflowRunHandoff.next_retry_at <= now,
        )
        resumable_state = or_(
            WorkflowRunHandoff.state == WorkflowHandoffState.READY,
            and_(
                WorkflowRunHandoff.state == WorkflowHandoffState.CLAIMED,
                WorkflowRunHandoff.lease_expires_at.is_not(None),
                WorkflowRunHandoff.lease_expires_at <= now,
            ),
        )
        newer_handoff = WorkflowRunHandoff.__table__.alias("newer_handoff")
        latest_generation = ~exists(
            select(1).where(
                newer_handoff.c.workflow_run_id == WorkflowRunHandoff.workflow_run_id,
                newer_handoff.c.generation > WorkflowRunHandoff.generation,
            )
        )
        running_workflow_run = exists(
            select(WorkflowRun.id).where(
                WorkflowRun.id == WorkflowRunHandoff.workflow_run_id,
                WorkflowRun.status == WorkflowExecutionStatus.RUNNING,
            )
        )
        stmt = (
            select(WorkflowRunHandoff)
            .where(
                resumable_state,
                retry_is_due,
                dispatch_is_due,
                WorkflowRunHandoff.attempts < max_attempts,
                WorkflowRunHandoff.cancel_requested_at.is_(None),
                latest_generation,
                running_workflow_run,
            )
            .order_by(WorkflowRunHandoff.created_at.asc(), WorkflowRunHandoff.id.asc())
            .limit(limit)
        )

        with self._session_factory() as session:
            handoffs = list(session.scalars(stmt))
            for handoff in handoffs:
                session.expunge(handoff)
            return handoffs

    @override
    def mark_dispatched(self, *, handoff_id: str, generation: int, dispatched_at: datetime) -> bool:
        with self._session_factory.begin() as session:
            result = session.execute(
                update(WorkflowRunHandoff)
                .where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                    WorkflowRunHandoff.state.in_([WorkflowHandoffState.READY, WorkflowHandoffState.CLAIMED]),
                    WorkflowRunHandoff.cancel_requested_at.is_(None),
                )
                .values(dispatched_at=dispatched_at)
            )
            return self._rowcount(result) == 1

    @override
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
        self._validate_positive(max_attempts=max_attempts)
        if not lease_owner:
            raise ValueError("lease_owner must not be empty")
        if lease_duration.total_seconds() <= 0:
            raise ValueError("lease_duration must be positive")

        with self._session_factory.begin() as session:
            workflow_run_id = session.scalar(
                select(WorkflowRunHandoff.workflow_run_id).where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                )
            )
            if workflow_run_id is None:
                return None
            workflow_run = session.scalar(
                select(WorkflowRun).where(WorkflowRun.id == workflow_run_id).with_for_update()
            )
            if workflow_run is None or workflow_run.status != WorkflowExecutionStatus.RUNNING:
                return None
            handoff = session.scalar(
                select(WorkflowRunHandoff)
                .where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                )
                .with_for_update()
            )
            latest_generation = session.scalar(
                select(WorkflowRunHandoff.generation)
                .where(WorkflowRunHandoff.workflow_run_id == workflow_run_id)
                .order_by(WorkflowRunHandoff.generation.desc())
                .limit(1)
            )
            if (
                handoff is None
                or latest_generation != generation
                or not self._can_claim(handoff, now=now, max_attempts=max_attempts)
            ):
                return None

            handoff.state = WorkflowHandoffState.CLAIMED
            handoff.target_worker_id = lease_owner
            handoff.lease_owner = lease_owner
            handoff.lease_token = str(uuidv7())
            handoff.lease_expires_at = now + lease_duration
            handoff.claimed_at = now
            handoff.attempts += 1
            handoff.next_retry_at = None
            return self._flush_and_detach(session, handoff)

    @override
    def renew_lease(
        self,
        *,
        handoff_id: str,
        generation: int,
        lease_owner: str,
        lease_token: str,
        lease_duration: timedelta,
        now: datetime,
    ) -> bool:
        if lease_duration.total_seconds() <= 0:
            raise ValueError("lease_duration must be positive")
        requested_expiration = now + lease_duration
        with self._session_factory.begin() as session:
            result = session.execute(
                update(WorkflowRunHandoff)
                .where(
                    *self._claim_identity_filters(
                        handoff_id=handoff_id,
                        generation=generation,
                        lease_owner=lease_owner,
                        lease_token=lease_token,
                    ),
                    WorkflowRunHandoff.cancel_requested_at.is_(None),
                )
                .values(
                    lease_expires_at=case(
                        (
                            or_(
                                WorkflowRunHandoff.lease_expires_at.is_(None),
                                WorkflowRunHandoff.lease_expires_at < requested_expiration,
                            ),
                            requested_expiration,
                        ),
                        else_=WorkflowRunHandoff.lease_expires_at,
                    )
                )
            )
            return self._rowcount(result) == 1

    @override
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
        self._validate_positive(max_attempts=max_attempts)
        with self._session_factory.begin() as session:
            workflow_run_id = session.scalar(
                select(WorkflowRunHandoff.workflow_run_id).where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                )
            )
            if workflow_run_id is None:
                return None
            workflow_run = session.scalar(
                select(WorkflowRun).where(WorkflowRun.id == workflow_run_id).with_for_update()
            )
            handoff = session.scalar(
                select(WorkflowRunHandoff)
                .where(
                    *self._claim_identity_filters(
                        handoff_id=handoff_id,
                        generation=generation,
                        lease_owner=lease_owner,
                        lease_token=lease_token,
                    )
                )
                .with_for_update()
            )
            if handoff is None:
                return None

            handoff.last_error = error
            handoff.lease_owner = None
            handoff.lease_token = None
            handoff.lease_expires_at = None
            handoff.dispatched_at = None
            if (
                workflow_run is None
                or workflow_run.status != WorkflowExecutionStatus.RUNNING
                or handoff.cancel_requested_at is not None
                or handoff.attempts >= max_attempts
            ):
                handoff.state = WorkflowHandoffState.FAILED
                handoff.failed_at = now
                handoff.next_retry_at = None
                if workflow_run is not None:
                    self._accumulate_terminal_handoff_duration(
                        workflow_run,
                        handoff=handoff,
                        terminal_at=now,
                    )
                    self._stop_locked_workflow_run_if_running(workflow_run, reason=error, now=now)
            else:
                handoff.state = WorkflowHandoffState.READY
                handoff.next_retry_at = retry_at
            return self._flush_and_detach(session, handoff)

    @override
    def mark_resumed(
        self,
        *,
        handoff_id: str,
        generation: int,
        lease_owner: str,
        lease_token: str,
        resumed_at: datetime,
    ) -> bool:
        with self._session_factory.begin() as session:
            workflow_run_id = session.scalar(
                select(WorkflowRunHandoff.workflow_run_id).where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                )
            )
            if workflow_run_id is None:
                return False
            workflow_run = session.scalar(
                select(WorkflowRun).where(WorkflowRun.id == workflow_run_id).with_for_update()
            )
            if workflow_run is None or workflow_run.status != WorkflowExecutionStatus.RUNNING:
                return False
            handoff = session.scalar(
                select(WorkflowRunHandoff)
                .where(
                    *self._claim_identity_filters(
                        handoff_id=handoff_id,
                        generation=generation,
                        lease_owner=lease_owner,
                        lease_token=lease_token,
                    ),
                    WorkflowRunHandoff.cancel_requested_at.is_(None),
                )
                .with_for_update()
            )
            if handoff is None:
                return False
            handoff.state = WorkflowHandoffState.RESUMED
            handoff.resumed_at = resumed_at
            handoff.lease_owner = None
            handoff.lease_token = None
            handoff.lease_expires_at = None
            handoff.next_retry_at = None
            self._accumulate_terminal_handoff_duration(
                workflow_run,
                handoff=handoff,
                terminal_at=resumed_at,
            )
            session.flush()
            return True

    @override
    def mark_failed(
        self,
        *,
        handoff_id: str,
        generation: int,
        error: str,
        failed_at: datetime,
        lease_owner: str | None = None,
        lease_token: str | None = None,
    ) -> bool:
        with self._session_factory.begin() as session:
            workflow_run_id = session.scalar(
                select(WorkflowRunHandoff.workflow_run_id).where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                )
            )
            if workflow_run_id is None:
                return False
            workflow_run = session.scalar(
                select(WorkflowRun).where(WorkflowRun.id == workflow_run_id).with_for_update()
            )
            handoff = session.scalar(
                select(WorkflowRunHandoff)
                .where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                )
                .with_for_update()
            )
            if handoff is None or handoff.state not in {
                WorkflowHandoffState.PREPARED,
                WorkflowHandoffState.READY,
                WorkflowHandoffState.CLAIMED,
            }:
                return False
            if handoff.state == WorkflowHandoffState.CLAIMED and (
                handoff.lease_owner != lease_owner or handoff.lease_token != lease_token
            ):
                return False

            handoff.state = WorkflowHandoffState.FAILED
            handoff.last_error = error
            handoff.failed_at = failed_at
            handoff.next_retry_at = None
            handoff.lease_owner = None
            handoff.lease_token = None
            handoff.lease_expires_at = None
            if workflow_run is not None:
                self._accumulate_terminal_handoff_duration(
                    workflow_run,
                    handoff=handoff,
                    terminal_at=failed_at,
                )
                self._stop_locked_workflow_run_if_running(workflow_run, reason=error, now=failed_at)
            session.flush()
            return True

    @override
    def request_cancel(
        self,
        *,
        workflow_run_id: str,
        requested_at: datetime,
        reason: str = "workflow run cancellation requested",
    ) -> int:
        if not workflow_run_id:
            raise ValueError("workflow_run_id must not be empty")
        with self._session_factory.begin() as session:
            workflow_run = session.scalar(
                select(WorkflowRun).where(WorkflowRun.id == workflow_run_id).with_for_update()
            )
            if workflow_run is None:
                return 0
            handoffs = list(
                session.scalars(
                    select(WorkflowRunHandoff)
                    .where(
                        WorkflowRunHandoff.workflow_run_id == workflow_run_id,
                        WorkflowRunHandoff.state.in_(self._ACTIVE_HANDOFF_STATES),
                        WorkflowRunHandoff.cancel_requested_at.is_(None),
                    )
                    .order_by(WorkflowRunHandoff.generation.asc())
                    .with_for_update()
                )
            )
            self._cancel_locked_handoffs(
                handoffs,
                requested_at=requested_at,
                reason=reason,
                workflow_runs_by_id={workflow_run.id: workflow_run},
            )
            if handoffs:
                self._stop_locked_workflow_run_if_running(workflow_run, reason=reason, now=requested_at)
            return len(handoffs)

    @override
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
        if not task_id:
            raise ValueError("task_id must not be empty")
        if not reason:
            raise ValueError("reason must not be empty")
        if (scope_tenant_id is None) != (scope_app_id is None):
            raise ValueError("scope_tenant_id and scope_app_id must be provided together")
        if (scope_created_by_role is None) != (scope_created_by is None):
            raise ValueError("scope_created_by_role and scope_created_by must be provided together")
        if scope_created_by is not None and (scope_tenant_id is None or scope_app_id is None):
            raise ValueError("creator scope requires tenant and app scope")
        resolved_expires_at = expires_at or requested_at + timedelta(days=7)
        if resolved_expires_at <= requested_at:
            raise ValueError("expires_at must be later than requested_at")
        # RESUMED means the next graph segment is already live. The existing
        # Redis Abort command owns that state; only durable, inactive handoff
        # states are terminalized here.
        with self._session_factory.begin() as session:
            # Opportunistically bound tombstone growth. An expired Stop can no
            # longer race a task whose maximum execution window has elapsed.
            session.execute(
                delete(WorkflowHandoffCancellation).where(
                    WorkflowHandoffCancellation.expires_at <= requested_at,
                )
            )
            existing_cancellation = session.scalar(
                select(WorkflowHandoffCancellation)
                .where(
                    WorkflowHandoffCancellation.task_id == task_id,
                    self._nullable_equals(WorkflowHandoffCancellation.scope_tenant_id, scope_tenant_id),
                    self._nullable_equals(WorkflowHandoffCancellation.scope_app_id, scope_app_id),
                    self._nullable_equals(
                        WorkflowHandoffCancellation.scope_created_by_role,
                        scope_created_by_role,
                    ),
                    self._nullable_equals(WorkflowHandoffCancellation.scope_created_by, scope_created_by),
                    WorkflowHandoffCancellation.expires_at > requested_at,
                )
                .order_by(WorkflowHandoffCancellation.requested_at.asc())
                .limit(1)
                .with_for_update()
            )
            if existing_cancellation is None:
                session.add(
                    WorkflowHandoffCancellation(
                        task_id=task_id,
                        scope_tenant_id=scope_tenant_id,
                        scope_app_id=scope_app_id,
                        scope_created_by_role=scope_created_by_role,
                        scope_created_by=scope_created_by,
                        requested_at=requested_at,
                        expires_at=resolved_expires_at,
                        reason=reason,
                    )
                )
                session.flush()
            elif existing_cancellation.expires_at < resolved_expires_at:
                existing_cancellation.expires_at = resolved_expires_at

            ownership_filters = self._workflow_run_scope_filters(
                scope_tenant_id=scope_tenant_id,
                scope_app_id=scope_app_id,
                scope_created_by_role=scope_created_by_role,
                scope_created_by=scope_created_by,
            )
            candidate_run_ids = list(
                session.scalars(
                    select(WorkflowRunHandoff.workflow_run_id)
                    .join(WorkflowRun, WorkflowRun.id == WorkflowRunHandoff.workflow_run_id)
                    .where(
                        WorkflowRunHandoff.task_id == task_id,
                        WorkflowRunHandoff.state.in_(self._ACTIVE_HANDOFF_STATES),
                        WorkflowRunHandoff.cancel_requested_at.is_(None),
                        *ownership_filters,
                    )
                    .distinct()
                )
            )
            if not candidate_run_ids:
                return 0
            workflow_runs = list(
                session.scalars(
                    select(WorkflowRun)
                    .where(WorkflowRun.id.in_(sorted(set(candidate_run_ids))))
                    .order_by(WorkflowRun.id.asc())
                    .with_for_update()
                )
            )
            handoffs = list(
                session.scalars(
                    select(WorkflowRunHandoff)
                    .join(WorkflowRun, WorkflowRun.id == WorkflowRunHandoff.workflow_run_id)
                    .where(
                        WorkflowRunHandoff.task_id == task_id,
                        WorkflowRunHandoff.state.in_(self._ACTIVE_HANDOFF_STATES),
                        WorkflowRunHandoff.cancel_requested_at.is_(None),
                        *ownership_filters,
                    )
                    .order_by(WorkflowRunHandoff.workflow_run_id.asc(), WorkflowRunHandoff.generation.asc())
                    .with_for_update()
                )
            )
            workflow_runs_by_id = {workflow_run.id: workflow_run for workflow_run in workflow_runs}
            self._cancel_locked_handoffs(
                handoffs,
                requested_at=requested_at,
                reason=reason,
                workflow_runs_by_id=workflow_runs_by_id,
            )
            cancelled_run_ids = {handoff.workflow_run_id for handoff in handoffs}
            for workflow_run in workflow_runs:
                if workflow_run.id in cancelled_run_ids:
                    self._stop_locked_workflow_run_if_running(workflow_run, reason=reason, now=requested_at)
            return len(handoffs)

    @override
    def fail_exhausted(self, *, now: datetime, max_attempts: int, error: str) -> int:
        self._validate_positive(max_attempts=max_attempts)
        exhausted_state = or_(
            WorkflowRunHandoff.state == WorkflowHandoffState.READY,
            and_(
                WorkflowRunHandoff.state == WorkflowHandoffState.CLAIMED,
                WorkflowRunHandoff.lease_expires_at.is_not(None),
                WorkflowRunHandoff.lease_expires_at <= now,
            ),
        )
        return self._fail_matching_and_stop_runs(
            filters=(exhausted_state, WorkflowRunHandoff.attempts >= max_attempts),
            now=now,
            error=error,
        )

    @override
    def fail_stale_prepared(self, *, now: datetime, stale_before: datetime, error: str, limit: int) -> int:
        self._validate_positive(limit=limit)
        return self._fail_matching_and_stop_runs(
            filters=(
                WorkflowRunHandoff.state.in_([WorkflowHandoffState.PREPARING, WorkflowHandoffState.PREPARED]),
                WorkflowRunHandoff.created_at <= stale_before,
            ),
            now=now,
            error=error,
            limit=limit,
        )

    @override
    def fail_stale_ready(self, *, now: datetime, stale_before: datetime, error: str, limit: int) -> int:
        self._validate_positive(limit=limit)
        return self._fail_matching_and_stop_runs(
            filters=(
                WorkflowRunHandoff.state == WorkflowHandoffState.READY,
                WorkflowRunHandoff.attempts == 0,
                # Activation stores its durable wall-clock timestamp in
                # next_retry_at. Broker redispatch updates dispatched_at, so
                # using that field here would let retries extend the deadline
                # forever when no consumer can acquire the first claim.
                WorkflowRunHandoff.next_retry_at.is_not(None),
                WorkflowRunHandoff.next_retry_at <= stale_before,
            ),
            now=now,
            error=error,
            limit=limit,
        )

    @override
    def list_failed_pending_terminal_compensation(self, *, limit: int) -> Sequence[WorkflowRunHandoff]:
        self._validate_positive(limit=limit)
        with self._session_factory() as session:
            handoffs = list(
                session.scalars(
                    select(WorkflowRunHandoff)
                    .where(
                        WorkflowRunHandoff.state == WorkflowHandoffState.FAILED,
                        WorkflowRunHandoff.terminal_compensated_at.is_(None),
                    )
                    .order_by(WorkflowRunHandoff.failed_at.asc(), WorkflowRunHandoff.created_at.asc())
                    .limit(limit)
                )
            )
            for handoff in handoffs:
                session.expunge(handoff)
            return handoffs

    @override
    def compensate_failed_terminal(
        self,
        *,
        handoff_id: str,
        generation: int,
        compensated_at: datetime,
    ) -> bool:
        with self._session_factory.begin() as session:
            workflow_run_id = session.scalar(
                select(WorkflowRunHandoff.workflow_run_id).where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                )
            )
            if workflow_run_id is None:
                return False
            workflow_run = session.scalar(
                select(WorkflowRun).where(WorkflowRun.id == workflow_run_id).with_for_update()
            )
            handoff = session.scalar(
                select(WorkflowRunHandoff)
                .where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                )
                .with_for_update()
            )
            if handoff is None or handoff.state != WorkflowHandoffState.FAILED:
                return False
            if handoff.terminal_compensated_at is not None:
                return True

            handoff.terminal_attempts += 1
            if workflow_run is None:
                # Retention/app deletion may remove the business record first.
                # The independent snapshot-GC outbox still owns the blob key.
                handoff.terminal_compensated_at = compensated_at
                handoff.terminal_event_published_at = compensated_at
                handoff.terminal_last_error = "workflow run no longer exists; terminal event skipped"
                return True

            terminal_at = handoff.failed_at or compensated_at
            if workflow_run.status == WorkflowExecutionStatus.RUNNING:
                self._stop_locked_workflow_run_if_running(
                    workflow_run,
                    reason=handoff.last_error or "workflow handoff failed",
                    now=terminal_at,
                )
            elif workflow_run.status != WorkflowExecutionStatus.STOPPED:
                # A real terminal outcome won a race with stale-handoff cleanup.
                # Never replace it with a synthetic STOPPED event.
                handoff.terminal_compensated_at = compensated_at
                handoff.terminal_event_published_at = compensated_at
                handoff.terminal_last_error = "workflow run already completed; terminal event skipped"
                return True
            else:
                workflow_run.error = workflow_run.error or handoff.last_error or "workflow handoff failed"
                workflow_run.finished_at = workflow_run.finished_at or terminal_at
                workflow_run.elapsed_time = max(
                    (terminal_at - workflow_run.created_at).total_seconds(),
                    workflow_run.elapsed_time or 0.0,
                    0.0,
                )

            if handoff.resume_route == WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW:
                self._compensate_trigger_log(
                    session,
                    workflow_run=workflow_run,
                    error=handoff.last_error or workflow_run.error or "workflow handoff failed",
                    terminal_at=terminal_at,
                )
            elif handoff.resume_route == WorkflowHandoffResumeRoute.ADVANCED_CHAT:
                self._compensate_advanced_chat_message(
                    session,
                    workflow_run=workflow_run,
                    error=handoff.last_error or workflow_run.error or "workflow handoff failed",
                    mark_error=handoff.cancel_requested_at is None,
                )
            elif handoff.resume_route == WorkflowHandoffResumeRoute.RAG_PIPELINE:
                self._compensate_rag_document(
                    session,
                    handoff=handoff,
                    workflow_run=workflow_run,
                    error=handoff.last_error or workflow_run.error or "workflow handoff failed",
                    terminal_at=terminal_at,
                )

            handoff.terminal_compensated_at = compensated_at
            handoff.terminal_last_error = None
            session.flush()
            return True

    @override
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
        """Persist post-ACK failure state before its terminal event is published."""
        error = (error or "resumed workflow stream failed")[:4000]
        with self._session_factory.begin() as session:
            # WorkflowRun is the allocation lock used by create_preparing too.
            # Locking it first prevents a newer generation from being created
            # between the latest-generation check and terminal compensation.
            workflow_run = session.scalar(
                select(WorkflowRun)
                .where(
                    WorkflowRun.id == scope.workflow_run_id,
                    WorkflowRun.tenant_id == scope.tenant_id,
                    WorkflowRun.app_id == scope.app_id,
                    WorkflowRun.workflow_id == scope.workflow_id,
                )
                .with_for_update()
            )
            if workflow_run is None:
                raise WorkflowHandoffTerminalOwnershipError(
                    f"Workflow run ownership changed before terminal reconciliation: {scope.workflow_run_id}"
                )

            handoff = session.scalar(
                select(WorkflowRunHandoff)
                .where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                    WorkflowRunHandoff.workflow_run_id == scope.workflow_run_id,
                    WorkflowRunHandoff.task_id == scope.task_id,
                    WorkflowRunHandoff.resume_route == scope.resume_route,
                )
                .with_for_update()
            )
            if handoff is None:
                raise WorkflowHandoffTerminalOwnershipError(
                    f"Workflow handoff ownership changed before terminal reconciliation: {handoff_id}"
                )
            newer_generation = session.scalar(
                select(WorkflowRunHandoff.generation)
                .where(
                    WorkflowRunHandoff.workflow_run_id == scope.workflow_run_id,
                    WorkflowRunHandoff.generation > generation,
                )
                .order_by(WorkflowRunHandoff.generation.desc())
                .limit(1)
            )
            if newer_generation is not None:
                raise WorkflowHandoffTerminalOwnershipError(
                    f"A newer workflow handoff generation owns the run: {newer_generation}"
                )
            if handoff.terminal_event_published_at is not None:
                return None
            if handoff.state not in {WorkflowHandoffState.RESUMED, WorkflowHandoffState.FAILED}:
                raise WorkflowHandoffTerminalOwnershipError(
                    f"Workflow handoff is no longer runtime-owned: state={handoff.state}"
                )
            if workflow_run.status == WorkflowExecutionStatus.PAUSED:
                # Human-input pause state has its own durable snapshot and
                # reconnect serializer. A workflow_finished(status=paused)
                # payload is not part of the public protocol, so do not replace
                # a failed live workflow_paused publication with that shape.
                handoff.terminal_compensated_at = handoff.terminal_compensated_at or failed_at
                handoff.terminal_event_published_at = failed_at
                handoff.terminal_attempts += 1
                handoff.terminal_last_error = "durable workflow pause snapshot owns reconnect delivery"
                session.flush()
                return None

            if (
                handoff.state == WorkflowHandoffState.RESUMED
                and workflow_run.status == WorkflowExecutionStatus.STOPPED
                and scope.resume_route == WorkflowHandoffResumeRoute.ADVANCED_CHAT
            ):
                # Stop won the race. Preserve any answer chunks that reached
                # the client without converting the stopped message to ERROR.
                self._compensate_advanced_chat_message(
                    session,
                    workflow_run=workflow_run,
                    error=workflow_run.error or "workflow stopped",
                    answer_delta=message_answer_delta,
                    answer_replacement=message_answer_replacement,
                    mark_error=False,
                )

            if handoff.state == WorkflowHandoffState.RESUMED and workflow_run.status == WorkflowExecutionStatus.RUNNING:
                handoff.state = WorkflowHandoffState.FAILED
                handoff.failed_at = failed_at
                handoff.last_error = error
                handoff.next_retry_at = None
                self._stop_locked_workflow_run_if_running(workflow_run, reason=error, now=failed_at)
                workflow_run.exceptions_count = (workflow_run.exceptions_count or 0) + 1
                if scope.resume_route == WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW:
                    self._compensate_trigger_log(
                        session,
                        workflow_run=workflow_run,
                        error=error,
                        terminal_at=failed_at,
                    )
                elif scope.resume_route == WorkflowHandoffResumeRoute.ADVANCED_CHAT:
                    self._compensate_advanced_chat_message(
                        session,
                        workflow_run=workflow_run,
                        error=error,
                        answer_delta=message_answer_delta,
                        answer_replacement=message_answer_replacement,
                    )
                elif scope.resume_route == WorkflowHandoffResumeRoute.RAG_PIPELINE:
                    self._compensate_rag_document(
                        session,
                        handoff=handoff,
                        workflow_run=workflow_run,
                        error=error,
                        terminal_at=failed_at,
                    )
            elif handoff.state == WorkflowHandoffState.FAILED and handoff.terminal_compensated_at is None:
                # This can occur when a post-ACK runtime failure races the
                # scanner. Complete the same compensation transaction here.
                terminal_at = handoff.failed_at or failed_at
                if workflow_run.status == WorkflowExecutionStatus.RUNNING:
                    self._stop_locked_workflow_run_if_running(
                        workflow_run,
                        reason=handoff.last_error or error,
                        now=terminal_at,
                    )
                if scope.resume_route == WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW:
                    self._compensate_trigger_log(
                        session,
                        workflow_run=workflow_run,
                        error=handoff.last_error or error,
                        terminal_at=terminal_at,
                    )
                elif scope.resume_route == WorkflowHandoffResumeRoute.ADVANCED_CHAT:
                    self._compensate_advanced_chat_message(
                        session,
                        workflow_run=workflow_run,
                        error=handoff.last_error or error,
                        answer_delta=message_answer_delta,
                        answer_replacement=message_answer_replacement,
                    )
                elif scope.resume_route == WorkflowHandoffResumeRoute.RAG_PIPELINE:
                    self._compensate_rag_document(
                        session,
                        handoff=handoff,
                        workflow_run=workflow_run,
                        error=handoff.last_error or error,
                        terminal_at=terminal_at,
                    )

            # A real workflow terminal status can win just before Redis
            # publication fails. Preserve that status and use this marker only
            # as an outbox so the scanner republishes the real terminal event.
            handoff.terminal_compensated_at = handoff.terminal_compensated_at or failed_at
            handoff.terminal_attempts += 1
            handoff.terminal_last_error = None
            session.flush()
            return self._build_terminal_event_from_session(session, handoff, workflow_run)

    @override
    def list_pending_terminal_events(self, *, limit: int) -> Sequence[WorkflowHandoffTerminalEvent]:
        self._validate_positive(limit=limit)
        with self._session_factory() as session:
            rows = session.execute(
                select(WorkflowRunHandoff, WorkflowRun)
                .join(WorkflowRun, WorkflowRun.id == WorkflowRunHandoff.workflow_run_id)
                .where(
                    WorkflowRunHandoff.state.in_([WorkflowHandoffState.FAILED, WorkflowHandoffState.RESUMED]),
                    WorkflowRunHandoff.terminal_compensated_at.is_not(None),
                    WorkflowRunHandoff.terminal_event_published_at.is_(None),
                    WorkflowRun.status != WorkflowExecutionStatus.RUNNING,
                )
                .order_by(WorkflowRunHandoff.terminal_compensated_at.asc(), WorkflowRunHandoff.id.asc())
                .limit(limit)
            ).all()
            return [
                self._build_terminal_event_from_session(session, handoff, workflow_run)
                for handoff, workflow_run in rows
            ]

    @override
    def mark_terminal_event_published(
        self,
        *,
        handoff_id: str,
        generation: int,
        published_at: datetime,
    ) -> bool:
        with self._session_factory.begin() as session:
            result = session.execute(
                update(WorkflowRunHandoff)
                .where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                    WorkflowRunHandoff.state.in_([WorkflowHandoffState.FAILED, WorkflowHandoffState.RESUMED]),
                    WorkflowRunHandoff.terminal_compensated_at.is_not(None),
                    WorkflowRunHandoff.terminal_event_published_at.is_(None),
                )
                .values(
                    terminal_event_published_at=published_at,
                    terminal_attempts=WorkflowRunHandoff.terminal_attempts + 1,
                    terminal_last_error=None,
                )
            )
            return self._rowcount(result) == 1

    @override
    def record_terminal_processing_failure(
        self,
        *,
        handoff_id: str,
        generation: int,
        error: str,
    ) -> bool:
        with self._session_factory.begin() as session:
            result = session.execute(
                update(WorkflowRunHandoff)
                .where(
                    WorkflowRunHandoff.id == handoff_id,
                    WorkflowRunHandoff.generation == generation,
                    WorkflowRunHandoff.state.in_([WorkflowHandoffState.FAILED, WorkflowHandoffState.RESUMED]),
                    WorkflowRunHandoff.terminal_compensated_at.is_not(None),
                    WorkflowRunHandoff.terminal_event_published_at.is_(None),
                )
                .values(
                    terminal_attempts=WorkflowRunHandoff.terminal_attempts + 1,
                    terminal_last_error=error,
                )
            )
            return self._rowcount(result) == 1

    @override
    def list_snapshot_gc_candidates(self, *, now: datetime, limit: int) -> Sequence[WorkflowHandoffSnapshotGC]:
        self._validate_positive(limit=limit)
        blocking_reference = exists(
            select(1).where(
                WorkflowRunHandoff.snapshot_object_key == WorkflowHandoffSnapshotGC.snapshot_object_key,
                or_(
                    WorkflowRunHandoff.state.not_in([WorkflowHandoffState.RESUMED, WorkflowHandoffState.FAILED]),
                    and_(
                        WorkflowRunHandoff.state == WorkflowHandoffState.FAILED,
                        or_(
                            WorkflowRunHandoff.terminal_compensated_at.is_(None),
                            WorkflowRunHandoff.terminal_event_published_at.is_(None),
                        ),
                    ),
                ),
            )
        )
        with self._session_factory() as session:
            records = list(
                session.scalars(
                    select(WorkflowHandoffSnapshotGC)
                    .where(
                        WorkflowHandoffSnapshotGC.deleted_at.is_(None),
                        or_(
                            WorkflowHandoffSnapshotGC.next_retry_at.is_(None),
                            WorkflowHandoffSnapshotGC.next_retry_at <= now,
                        ),
                        ~blocking_reference,
                    )
                    .order_by(WorkflowHandoffSnapshotGC.created_at.asc(), WorkflowHandoffSnapshotGC.id.asc())
                    .limit(limit)
                )
            )
            for record in records:
                session.expunge(record)
            return records

    @override
    def delete_snapshot_if_unreferenced(
        self,
        *,
        snapshot_object_key: str,
        deleted_at: datetime,
        delete_object: Callable[[str], bool],
    ) -> WorkflowHandoffSnapshotDeleteOutcome:
        with self._session_factory.begin() as session:
            record = session.scalar(
                select(WorkflowHandoffSnapshotGC)
                .where(WorkflowHandoffSnapshotGC.snapshot_object_key == snapshot_object_key)
                .with_for_update()
            )
            if record is None:
                return WorkflowHandoffSnapshotDeleteOutcome.BLOCKED
            if record.deleted_at is not None:
                return WorkflowHandoffSnapshotDeleteOutcome.ALREADY_DELETED
            if self._snapshot_has_blocking_reference(session, snapshot_object_key=snapshot_object_key):
                return WorkflowHandoffSnapshotDeleteOutcome.BLOCKED

            existed = delete_object(snapshot_object_key)
            record.deleted_at = deleted_at
            record.attempts += 1
            record.next_retry_at = None
            record.last_error = None
            session.flush()
            return (
                WorkflowHandoffSnapshotDeleteOutcome.DELETED
                if existed
                else WorkflowHandoffSnapshotDeleteOutcome.MISSING
            )

    @override
    def record_snapshot_gc_failure(
        self,
        *,
        snapshot_object_key: str,
        error: str,
        retry_at: datetime,
    ) -> bool:
        with self._session_factory.begin() as session:
            result = session.execute(
                update(WorkflowHandoffSnapshotGC)
                .where(
                    WorkflowHandoffSnapshotGC.snapshot_object_key == snapshot_object_key,
                    WorkflowHandoffSnapshotGC.deleted_at.is_(None),
                )
                .values(
                    attempts=WorkflowHandoffSnapshotGC.attempts + 1,
                    next_retry_at=retry_at,
                    last_error=error,
                )
            )
            return self._rowcount(result) == 1

    @override
    def cleanup_expired_cancellations(self, *, now: datetime, limit: int) -> int:
        self._validate_positive(limit=limit)
        with self._session_factory.begin() as session:
            cancellation_ids = list(
                session.scalars(
                    select(WorkflowHandoffCancellation.id)
                    .where(WorkflowHandoffCancellation.expires_at <= now)
                    .order_by(WorkflowHandoffCancellation.expires_at.asc())
                    .limit(limit)
                )
            )
            if not cancellation_ids:
                return 0
            result = session.execute(
                delete(WorkflowHandoffCancellation).where(WorkflowHandoffCancellation.id.in_(cancellation_ids))
            )
            return self._rowcount(result)

    @override
    def cleanup_terminal_handoffs(self, *, terminal_before: datetime, limit: int) -> int:
        """Prune only terminal handoffs whose durable responsibilities are complete.

        Candidate discovery is intentionally separate from the locked delete.
        Each delete then follows the runtime lock order (parent run, handoff,
        snapshot-GC row) and rechecks every eligibility fence. This keeps the
        operation bounded without racing a terminal transition or reuse of a
        content-addressed snapshot key.
        """
        self._validate_positive(limit=limit)
        terminal_at = case(
            (WorkflowRunHandoff.state == WorkflowHandoffState.RESUMED, WorkflowRunHandoff.resumed_at),
            else_=WorkflowRunHandoff.failed_at,
        )
        parent_is_running = exists().where(
            WorkflowRun.id == WorkflowRunHandoff.workflow_run_id,
            WorkflowRun.status == WorkflowExecutionStatus.RUNNING,
        )
        deleted_snapshot = exists().where(
            WorkflowHandoffSnapshotGC.snapshot_object_key == WorkflowRunHandoff.snapshot_object_key,
            WorkflowHandoffSnapshotGC.deleted_at.is_not(None),
        )
        failed_terminal_reconciled = or_(
            WorkflowRunHandoff.state != WorkflowHandoffState.FAILED,
            and_(
                WorkflowRunHandoff.terminal_compensated_at.is_not(None),
                WorkflowRunHandoff.terminal_event_published_at.is_not(None),
            ),
        )
        resumed_terminal_outbox_complete = or_(
            WorkflowRunHandoff.state != WorkflowHandoffState.RESUMED,
            WorkflowRunHandoff.terminal_compensated_at.is_(None),
            WorkflowRunHandoff.terminal_event_published_at.is_not(None),
        )
        rag_group_metadata_complete = and_(
            WorkflowRunHandoff.rag_source_batch_id.is_not(None),
            WorkflowRunHandoff.rag_tenant_id.is_not(None),
            WorkflowRunHandoff.rag_queue_kind.is_not(None),
            WorkflowRunHandoff.rag_dataset_id.is_not(None),
            WorkflowRunHandoff.rag_tenant_isolated.is_not(None),
        )
        rag_reconciled = and_(
            # A RAG route without its durable group identity cannot prove that
            # tenant-slot ownership was released, so retain it for inspection.
            or_(
                WorkflowRunHandoff.resume_route != WorkflowHandoffResumeRoute.RAG_PIPELINE,
                rag_group_metadata_complete,
            ),
            or_(
                WorkflowRunHandoff.rag_source_batch_id.is_(None),
                and_(
                    rag_group_metadata_complete,
                    WorkflowRunHandoff.rag_group_sealed_at.is_not(None),
                    WorkflowRunHandoff.rag_tenant_slot_released_at.is_not(None),
                ),
            ),
            or_(
                WorkflowRunHandoff.state != WorkflowHandoffState.FAILED,
                WorkflowRunHandoff.rag_document_id.is_(None),
                WorkflowRunHandoff.rag_document_error_marked_at.is_not(None),
            ),
        )
        with self._session_factory() as session:
            candidate_ids = list(
                session.scalars(
                    select(WorkflowRunHandoff.id)
                    .where(
                        WorkflowRunHandoff.state.in_([WorkflowHandoffState.RESUMED, WorkflowHandoffState.FAILED]),
                        terminal_at <= terminal_before,
                        ~parent_is_running,
                        deleted_snapshot,
                        failed_terminal_reconciled,
                        resumed_terminal_outbox_complete,
                        rag_reconciled,
                    )
                    .order_by(terminal_at.asc(), WorkflowRunHandoff.id.asc())
                    .limit(limit)
                )
            )

        deleted_count = 0
        for handoff_id in candidate_ids:
            with self._session_factory.begin() as session:
                workflow_run_id = session.scalar(
                    select(WorkflowRunHandoff.workflow_run_id).where(WorkflowRunHandoff.id == handoff_id)
                )
                if workflow_run_id is None:
                    continue
                workflow_run = session.scalar(
                    select(WorkflowRun).where(WorkflowRun.id == workflow_run_id).with_for_update()
                )
                if workflow_run is not None and workflow_run.status == WorkflowExecutionStatus.RUNNING:
                    continue
                handoff = session.scalar(
                    select(WorkflowRunHandoff).where(WorkflowRunHandoff.id == handoff_id).with_for_update()
                )
                if handoff is None or not self._terminal_handoff_is_retention_safe(
                    handoff,
                    terminal_before=terminal_before,
                ):
                    continue
                snapshot_gc = session.scalar(
                    select(WorkflowHandoffSnapshotGC)
                    .where(WorkflowHandoffSnapshotGC.snapshot_object_key == handoff.snapshot_object_key)
                    .with_for_update()
                )
                if snapshot_gc is None or snapshot_gc.deleted_at is None:
                    continue
                session.delete(handoff)
                session.flush()
                deleted_count += 1
        return deleted_count

    @override
    def cleanup_completed_snapshot_gc(self, *, deleted_before: datetime, limit: int) -> int:
        """Prune completed GC rows after their audit window and final reference."""
        self._validate_positive(limit=limit)
        handoff_reference = exists().where(
            WorkflowRunHandoff.snapshot_object_key == WorkflowHandoffSnapshotGC.snapshot_object_key
        )
        with self._session_factory() as session:
            candidate_ids = list(
                session.scalars(
                    select(WorkflowHandoffSnapshotGC.id)
                    .where(
                        WorkflowHandoffSnapshotGC.deleted_at.is_not(None),
                        WorkflowHandoffSnapshotGC.deleted_at <= deleted_before,
                        ~handoff_reference,
                    )
                    .order_by(
                        WorkflowHandoffSnapshotGC.deleted_at.asc(),
                        WorkflowHandoffSnapshotGC.id.asc(),
                    )
                    .limit(limit)
                )
            )

        deleted_count = 0
        for record_id in candidate_ids:
            with self._session_factory.begin() as session:
                record = session.scalar(
                    select(WorkflowHandoffSnapshotGC).where(WorkflowHandoffSnapshotGC.id == record_id).with_for_update()
                )
                if (
                    record is None
                    or record.deleted_at is None
                    or record.deleted_at > deleted_before
                    or session.scalar(
                        select(exists().where(WorkflowRunHandoff.snapshot_object_key == record.snapshot_object_key))
                    )
                ):
                    continue
                # create_preparing() locks this same GC row before adding a
                # reference, so no new reference can cross this final check.
                session.delete(record)
                session.flush()
                deleted_count += 1
        return deleted_count

    @staticmethod
    def _terminal_handoff_is_retention_safe(
        handoff: WorkflowRunHandoff,
        *,
        terminal_before: datetime,
    ) -> bool:
        if handoff.state == WorkflowHandoffState.RESUMED:
            if handoff.resumed_at is None or handoff.resumed_at > terminal_before:
                return False
            if handoff.terminal_compensated_at is not None and handoff.terminal_event_published_at is None:
                return False
        elif handoff.state == WorkflowHandoffState.FAILED:
            if handoff.failed_at is None or handoff.failed_at > terminal_before:
                return False
            if handoff.terminal_compensated_at is None or handoff.terminal_event_published_at is None:
                return False
            if handoff.rag_document_id is not None and handoff.rag_document_error_marked_at is None:
                return False
        else:
            return False

        has_rag_group = handoff.rag_source_batch_id is not None
        if handoff.resume_route == WorkflowHandoffResumeRoute.RAG_PIPELINE and not has_rag_group:
            return False
        if has_rag_group:
            if (
                handoff.rag_tenant_id is None
                or handoff.rag_queue_kind is None
                or handoff.rag_dataset_id is None
                or handoff.rag_tenant_isolated is None
                or handoff.rag_group_sealed_at is None
                or handoff.rag_tenant_slot_released_at is None
            ):
                return False
        return True

    @staticmethod
    def _ensure_snapshot_gc_reference(session: Session, *, snapshot_object_key: str) -> None:
        record = session.scalar(
            select(WorkflowHandoffSnapshotGC)
            .where(WorkflowHandoffSnapshotGC.snapshot_object_key == snapshot_object_key)
            .with_for_update()
        )
        if record is None:
            # Snapshot keys are content-addressed, so two workflow runs may
            # legitimately prepare the same key concurrently. Isolate the
            # unique-key race in a savepoint, then lock the winner's row.
            try:
                with session.begin_nested():
                    record = WorkflowHandoffSnapshotGC(snapshot_object_key=snapshot_object_key)
                    session.add(record)
                    session.flush()
            except IntegrityError:
                record = session.scalar(
                    select(WorkflowHandoffSnapshotGC)
                    .where(WorkflowHandoffSnapshotGC.snapshot_object_key == snapshot_object_key)
                    .with_for_update()
                )
                if record is None:
                    raise

        if record.deleted_at is not None:
            # A content-addressed key can be reused after its previous object
            # was collected. Rearm the outbox before the new upload starts.
            record.deleted_at = None
            record.upload_completed_at = None
            record.attempts = 0
            record.next_retry_at = None
            record.last_error = None

    @staticmethod
    def _mark_snapshot_upload_completed(session: Session, *, snapshot_object_key: str) -> None:
        SQLAlchemyWorkflowRunHandoffRepository._ensure_snapshot_gc_reference(
            session,
            snapshot_object_key=snapshot_object_key,
        )
        record = session.scalar(
            select(WorkflowHandoffSnapshotGC)
            .where(WorkflowHandoffSnapshotGC.snapshot_object_key == snapshot_object_key)
            .with_for_update()
        )
        assert record is not None
        record.upload_completed_at = naive_utc_now()
        record.deleted_at = None
        record.next_retry_at = None
        record.last_error = None

    @staticmethod
    def _snapshot_has_blocking_reference(session: Session, *, snapshot_object_key: str) -> bool:
        return bool(
            session.scalar(
                select(
                    exists().where(
                        WorkflowRunHandoff.snapshot_object_key == snapshot_object_key,
                        or_(
                            WorkflowRunHandoff.state.not_in(
                                [WorkflowHandoffState.RESUMED, WorkflowHandoffState.FAILED]
                            ),
                            and_(
                                WorkflowRunHandoff.state == WorkflowHandoffState.FAILED,
                                or_(
                                    WorkflowRunHandoff.terminal_compensated_at.is_(None),
                                    WorkflowRunHandoff.terminal_event_published_at.is_(None),
                                ),
                            ),
                        ),
                    )
                )
            )
        )

    @staticmethod
    def _compensate_trigger_log(
        session: Session,
        *,
        workflow_run: WorkflowRun,
        error: str,
        terminal_at: datetime,
    ) -> None:
        trigger_log = session.scalar(
            select(WorkflowTriggerLog)
            .where(WorkflowTriggerLog.workflow_run_id == workflow_run.id)
            .order_by(WorkflowTriggerLog.created_at.desc(), WorkflowTriggerLog.id.desc())
            .limit(1)
            .with_for_update()
        )
        if trigger_log is None or trigger_log.status == WorkflowTriggerStatus.SUCCEEDED:
            return
        trigger_log.status = WorkflowTriggerStatus.FAILED
        trigger_log.error = trigger_log.error or error
        trigger_log.finished_at = trigger_log.finished_at or terminal_at
        trigger_log.elapsed_time = max(
            (terminal_at - workflow_run.created_at).total_seconds(),
            trigger_log.elapsed_time or 0.0,
            0.0,
        )
        trigger_log.total_tokens = workflow_run.total_tokens or trigger_log.total_tokens or 0

    @staticmethod
    def _compensate_advanced_chat_message(
        session: Session,
        *,
        workflow_run: WorkflowRun,
        error: str,
        answer_delta: str = "",
        answer_replacement: str | None = None,
        mark_error: bool = True,
    ) -> None:
        message = session.scalar(
            select(Message)
            .where(
                Message.app_id == workflow_run.app_id,
                Message.workflow_run_id == workflow_run.id,
            )
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(1)
            .with_for_update()
        )
        if message is None:
            return
        # Keep the streamed partial answer available to the user while making
        # the interrupted run unambiguously terminal.
        if answer_replacement is not None:
            message.answer = answer_replacement + answer_delta
        elif answer_delta and not (message.answer or "").endswith(answer_delta):
            message.answer = (message.answer or "") + answer_delta
        if mark_error:
            message.status = MessageStatus.ERROR
            message.error = message.error or error
        else:
            message.status = MessageStatus.NORMAL
            message.error = None

    @staticmethod
    def _compensate_rag_document(
        session: Session,
        *,
        handoff: WorkflowRunHandoff,
        workflow_run: WorkflowRun,
        error: str,
        terminal_at: datetime,
    ) -> None:
        if handoff.rag_document_id is None:
            return
        if handoff.rag_dataset_id is None or handoff.rag_tenant_id != workflow_run.tenant_id:
            raise WorkflowHandoffTerminalOwnershipError(
                f"RAG handoff document ownership metadata is incomplete: {handoff.id}"
            )
        document = session.scalar(
            select(Document)
            .where(
                Document.id == handoff.rag_document_id,
                Document.dataset_id == handoff.rag_dataset_id,
                Document.tenant_id == workflow_run.tenant_id,
            )
            .with_for_update()
        )
        if document is not None and document.indexing_status != IndexingStatus.COMPLETED:
            document.indexing_status = IndexingStatus.ERROR
            document.error = document.error or error
            document.stopped_at = document.stopped_at or terminal_at
        # Missing/completed documents need no retry; the durable marker also
        # prevents the group scanner from overwriting a completed document.
        handoff.rag_document_error_marked_at = terminal_at

    @staticmethod
    def _build_terminal_event_from_session(
        session: Session,
        handoff: WorkflowRunHandoff,
        workflow_run: WorkflowRun,
    ) -> WorkflowHandoffTerminalEvent:
        message = session.scalar(
            select(Message)
            .where(
                Message.app_id == workflow_run.app_id,
                Message.workflow_run_id == workflow_run.id,
            )
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(1)
        )
        message_files: list[Mapping[str, Any]] = []
        if message is not None:
            persisted_files = list(session.scalars(select(MessageFile).where(MessageFile.message_id == message.id)))
            upload_file_ids = list(
                dict.fromkeys(
                    item.upload_file_id
                    for item in persisted_files
                    if item.transfer_method == FileTransferMethod.LOCAL_FILE and item.upload_file_id
                )
            )
            upload_files_map: dict[str, UploadFile] = {}
            if upload_file_ids:
                upload_files = session.scalars(select(UploadFile).where(UploadFile.id.in_(upload_file_ids))).all()
                upload_files_map = {item.id: item for item in upload_files}
            message_files = [prepare_file_dict(item, upload_files_map) for item in persisted_files]
        return SQLAlchemyWorkflowRunHandoffRepository._build_terminal_event(
            handoff,
            workflow_run,
            message=message,
            message_files=message_files,
        )

    @staticmethod
    def _build_terminal_event(
        handoff: WorkflowRunHandoff,
        workflow_run: WorkflowRun,
        *,
        message: Message | None,
        message_files: Sequence[Mapping[str, Any]],
    ) -> WorkflowHandoffTerminalEvent:
        return WorkflowHandoffTerminalEvent(
            handoff_id=handoff.id,
            generation=handoff.generation,
            task_id=handoff.task_id,
            resume_route=handoff.resume_route,
            workflow_run_id=workflow_run.id,
            workflow_id=workflow_run.workflow_id,
            status=workflow_run.status,
            outputs=workflow_run.outputs_dict,
            error=workflow_run.error,
            elapsed_time=workflow_run.elapsed_time or 0.0,
            total_tokens=workflow_run.total_tokens or 0,
            total_steps=workflow_run.total_steps or 0,
            created_at=workflow_run.created_at,
            finished_at=workflow_run.finished_at,
            exceptions_count=workflow_run.exceptions_count or 0,
            handoff_duration=workflow_run.handoff_duration or 0.0,
            message_id=message.id if message is not None else None,
            message_answer=message.answer if message is not None else None,
            message_metadata=message.message_metadata_dict if message is not None else None,
            message_files=tuple(message_files),
        )

    def _fail_matching_and_stop_runs(
        self,
        *,
        filters: tuple[ColumnElement[bool], ...],
        now: datetime,
        error: str,
        limit: int | None = None,
    ) -> int:
        newer_handoff = WorkflowRunHandoff.__table__.alias("newer_handoff_to_fail")
        latest_generation = ~exists(
            select(1).where(
                newer_handoff.c.workflow_run_id == WorkflowRunHandoff.workflow_run_id,
                newer_handoff.c.generation > WorkflowRunHandoff.generation,
            )
        )
        with self._session_factory.begin() as session:
            candidate_stmt = (
                select(WorkflowRunHandoff.id, WorkflowRunHandoff.workflow_run_id)
                .where(*filters, latest_generation)
                .order_by(WorkflowRunHandoff.created_at.asc(), WorkflowRunHandoff.id.asc())
            )
            if limit is not None:
                candidate_stmt = candidate_stmt.limit(limit)
            candidates = list(session.execute(candidate_stmt).tuples())
            if not candidates:
                return 0

            candidate_ids = [handoff_id for handoff_id, _ in candidates]
            candidate_run_ids = sorted({workflow_run_id for _, workflow_run_id in candidates})
            workflow_runs = list(
                session.scalars(
                    select(WorkflowRun)
                    .where(WorkflowRun.id.in_(candidate_run_ids))
                    .order_by(WorkflowRun.id.asc())
                    .with_for_update()
                )
            )
            handoffs = list(
                session.scalars(
                    select(WorkflowRunHandoff)
                    .where(WorkflowRunHandoff.id.in_(candidate_ids), *filters, latest_generation)
                    .order_by(WorkflowRunHandoff.workflow_run_id.asc(), WorkflowRunHandoff.generation.asc())
                    .with_for_update()
                )
            )
            workflow_runs_by_id = {workflow_run.id: workflow_run for workflow_run in workflow_runs}
            failed_run_ids: set[str] = set()
            for handoff in handoffs:
                handoff.state = WorkflowHandoffState.FAILED
                handoff.last_error = error
                handoff.failed_at = now
                handoff.next_retry_at = None
                handoff.lease_owner = None
                handoff.lease_token = None
                handoff.lease_expires_at = None
                failed_run_ids.add(handoff.workflow_run_id)
                workflow_run = workflow_runs_by_id.get(handoff.workflow_run_id)
                if workflow_run is not None:
                    self._accumulate_terminal_handoff_duration(
                        workflow_run,
                        handoff=handoff,
                        terminal_at=now,
                    )
            for workflow_run in workflow_runs:
                if workflow_run.id in failed_run_ids:
                    self._stop_locked_workflow_run_if_running(workflow_run, reason=error, now=now)
            session.flush()
            return len(handoffs)

    @staticmethod
    def _get_matching_task_cancellation(
        session: Session,
        *,
        task_id: str,
        workflow_run: WorkflowRun,
    ) -> WorkflowHandoffCancellation | None:
        global_scope = and_(
            WorkflowHandoffCancellation.scope_tenant_id.is_(None),
            WorkflowHandoffCancellation.scope_app_id.is_(None),
        )
        owner_scope = and_(
            WorkflowHandoffCancellation.scope_tenant_id == workflow_run.tenant_id,
            WorkflowHandoffCancellation.scope_app_id == workflow_run.app_id,
            or_(
                and_(
                    WorkflowHandoffCancellation.scope_created_by_role.is_(None),
                    WorkflowHandoffCancellation.scope_created_by.is_(None),
                ),
                and_(
                    WorkflowHandoffCancellation.scope_created_by_role == workflow_run.created_by_role,
                    WorkflowHandoffCancellation.scope_created_by == workflow_run.created_by,
                ),
            ),
        )
        return session.scalar(
            select(WorkflowHandoffCancellation)
            .where(
                WorkflowHandoffCancellation.task_id == task_id,
                WorkflowHandoffCancellation.expires_at > func.current_timestamp(),
                or_(global_scope, owner_scope),
            )
            .order_by(WorkflowHandoffCancellation.requested_at.asc(), WorkflowHandoffCancellation.id.asc())
            .limit(1)
            .with_for_update()
        )

    @staticmethod
    def _workflow_run_scope_filters(
        *,
        scope_tenant_id: str | None,
        scope_app_id: str | None,
        scope_created_by_role: CreatorUserRole | None = None,
        scope_created_by: str | None = None,
    ) -> tuple[ColumnElement[bool], ...]:
        filters: list[ColumnElement[bool]] = []
        if scope_tenant_id is not None:
            filters.append(WorkflowRun.tenant_id == scope_tenant_id)
        if scope_app_id is not None:
            filters.append(WorkflowRun.app_id == scope_app_id)
        if scope_created_by_role is not None:
            filters.append(WorkflowRun.created_by_role == scope_created_by_role)
        if scope_created_by is not None:
            filters.append(WorkflowRun.created_by == scope_created_by)
        return tuple(filters)

    @staticmethod
    def _nullable_equals(column: InstrumentedAttribute[str | None], value: str | None) -> ColumnElement[bool]:
        return column.is_(None) if value is None else column == value

    @staticmethod
    def _cancel_locked_handoffs(
        handoffs: Sequence[WorkflowRunHandoff],
        *,
        requested_at: datetime,
        reason: str,
        workflow_runs_by_id: dict[str, WorkflowRun],
    ) -> None:
        for handoff in handoffs:
            handoff.state = WorkflowHandoffState.FAILED
            handoff.cancel_requested_at = requested_at
            handoff.failed_at = requested_at
            handoff.last_error = reason
            handoff.next_retry_at = None
            handoff.lease_owner = None
            handoff.lease_token = None
            handoff.lease_expires_at = None
            workflow_run = workflow_runs_by_id.get(handoff.workflow_run_id)
            if workflow_run is not None:
                SQLAlchemyWorkflowRunHandoffRepository._accumulate_terminal_handoff_duration(
                    workflow_run,
                    handoff=handoff,
                    terminal_at=requested_at,
                )

    @staticmethod
    def _accumulate_terminal_handoff_duration(
        workflow_run: WorkflowRun,
        *,
        handoff: WorkflowRunHandoff,
        terminal_at: datetime,
    ) -> None:
        handoff_duration = max((terminal_at - handoff.created_at).total_seconds(), 0.0)
        workflow_run.handoff_duration = (workflow_run.handoff_duration or 0.0) + handoff_duration

    @staticmethod
    def _stop_locked_workflow_run_if_running(
        workflow_run: WorkflowRun,
        *,
        reason: str,
        now: datetime,
    ) -> bool:
        if workflow_run.status != WorkflowExecutionStatus.RUNNING:
            return False
        workflow_run.status = WorkflowExecutionStatus.STOPPED
        workflow_run.error = reason
        workflow_run.finished_at = now
        workflow_run.elapsed_time = max((now - workflow_run.created_at).total_seconds(), 0.0)
        return True

    @staticmethod
    def _can_claim(handoff: WorkflowRunHandoff, *, now: datetime, max_attempts: int) -> bool:
        if handoff.cancel_requested_at is not None or handoff.attempts >= max_attempts:
            return False
        if handoff.next_retry_at is not None and handoff.next_retry_at > now:
            return False
        if handoff.state == WorkflowHandoffState.READY:
            return True
        return (
            handoff.state == WorkflowHandoffState.CLAIMED
            and handoff.lease_expires_at is not None
            and handoff.lease_expires_at <= now
        )

    @staticmethod
    def _has_same_checkpoint(
        handoff: WorkflowRunHandoff,
        *,
        task_id: str,
        snapshot_object_key: str,
        snapshot_schema_version: str,
        snapshot_checksum: str,
        snapshot_size_bytes: int,
        resume_route: WorkflowHandoffResumeRoute,
        rag_group_metadata: RagPipelineHandoffGroupMetadata | None,
    ) -> bool:
        persisted_rag_group_metadata = (
            RagPipelineHandoffGroupMetadata(
                source_batch_id=handoff.rag_source_batch_id,
                tenant_id=handoff.rag_tenant_id,
                queue_kind=handoff.rag_queue_kind,
                dataset_id=handoff.rag_dataset_id,
                document_id=handoff.rag_document_id,
                tenant_isolated=bool(handoff.rag_tenant_isolated),
            )
            if handoff.rag_source_batch_id
            and handoff.rag_tenant_id
            and handoff.rag_queue_kind
            and handoff.rag_dataset_id
            else None
        )
        return (
            handoff.task_id == task_id
            and handoff.snapshot_object_key == snapshot_object_key
            and handoff.snapshot_schema_version == snapshot_schema_version
            and handoff.snapshot_checksum == snapshot_checksum
            and handoff.snapshot_size_bytes == snapshot_size_bytes
            and handoff.resume_route == resume_route
            and persisted_rag_group_metadata == rag_group_metadata
        )

    @staticmethod
    def _claim_identity_filters(
        *,
        handoff_id: str,
        generation: int,
        lease_owner: str,
        lease_token: str,
    ) -> tuple[ColumnElement[bool], ...]:
        return (
            WorkflowRunHandoff.id == handoff_id,
            WorkflowRunHandoff.generation == generation,
            WorkflowRunHandoff.state == WorkflowHandoffState.CLAIMED,
            WorkflowRunHandoff.lease_owner == lease_owner,
            WorkflowRunHandoff.lease_token == lease_token,
        )

    @staticmethod
    def _flush_and_detach(session: Session, handoff: WorkflowRunHandoff) -> WorkflowRunHandoff:
        session.flush()
        session.expunge(handoff)
        return handoff

    @staticmethod
    def _detach(session: Session, handoff: WorkflowRunHandoff | None) -> WorkflowRunHandoff | None:
        if handoff is not None:
            session.expunge(handoff)
        return handoff

    @staticmethod
    def _detach_required(session: Session, handoff: WorkflowRunHandoff) -> WorkflowRunHandoff:
        session.expunge(handoff)
        return handoff

    @staticmethod
    def _rowcount(result: object) -> int:
        return cast(CursorResult, result).rowcount or 0

    @staticmethod
    def _validate_positive(**values: int) -> None:
        for name, value in values.items():
            if value <= 0:
                raise ValueError(f"{name} must be positive")


__all__ = [
    "ActiveWorkflowRunHandoffError",
    "SQLAlchemyWorkflowRunHandoffRepository",
    "WorkflowHandoffPreparationCancelledError",
    "WorkflowRunNotFoundForHandoffError",
    "WorkflowRunNotResumableForHandoffError",
]
