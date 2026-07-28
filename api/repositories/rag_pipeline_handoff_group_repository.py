from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, cast, override

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from models.dataset import Document
from models.enums import IndexingStatus
from models.workflow import WorkflowRun
from models.workflow_handoff import (
    RagPipelineHandoffGroupIdentity,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)


@dataclass(frozen=True)
class RagPipelineHandoffGroupSnapshot:
    identity: RagPipelineHandoffGroupIdentity
    sealed_at: datetime | None
    released_at: datetime | None
    tenant_isolated: bool
    has_running_workflow_runs: bool


class RagPipelineHandoffGroupRepository(Protocol):
    def seal_group(self, *, identity: RagPipelineHandoffGroupIdentity, sealed_at: datetime) -> int: ...

    def get_group(self, identity: RagPipelineHandoffGroupIdentity) -> RagPipelineHandoffGroupSnapshot | None: ...

    def list_reconcilable_groups(self, *, limit: int) -> Sequence[RagPipelineHandoffGroupIdentity]: ...

    def mark_failed_documents(self, *, identity: RagPipelineHandoffGroupIdentity, marked_at: datetime) -> int: ...

    def mark_released_once(self, *, identity: RagPipelineHandoffGroupIdentity, released_at: datetime) -> bool: ...


class SQLAlchemyRagPipelineHandoffGroupRepository(RagPipelineHandoffGroupRepository):
    """Database half of RAG tenant-slot handoff ownership.

    Redis/Celery side effects stay in the service. Group lifecycle markers live
    beside every handoff generation so the periodic scanner can recover after a
    worker exits between the handoff and tenant-slot release.
    """

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def seal_group(self, *, identity: RagPipelineHandoffGroupIdentity, sealed_at: datetime) -> int:
        with self._session_factory.begin() as session:
            rows = self._locked_group_rows(session, identity)
            for row in rows:
                if row.rag_group_sealed_at is None:
                    row.rag_group_sealed_at = sealed_at
            session.flush()
            return len(rows)

    @override
    def get_group(self, identity: RagPipelineHandoffGroupIdentity) -> RagPipelineHandoffGroupSnapshot | None:
        with self._session_factory() as session:
            rows = list(session.scalars(select(WorkflowRunHandoff).where(*self._group_filters(identity))))
            if not rows:
                return None
            self._validate_group_rows(rows)
            run_ids = sorted({row.workflow_run_id for row in rows})
            has_running = session.scalar(
                select(
                    exists().where(
                        WorkflowRun.id.in_(run_ids),
                        WorkflowRun.status == WorkflowExecutionStatus.RUNNING,
                    )
                )
            )
            sealed_values = [row.rag_group_sealed_at for row in rows if row.rag_group_sealed_at is not None]
            released_values = [
                row.rag_tenant_slot_released_at for row in rows if row.rag_tenant_slot_released_at is not None
            ]
            return RagPipelineHandoffGroupSnapshot(
                identity=identity,
                sealed_at=max(sealed_values) if len(sealed_values) == len(rows) else None,
                released_at=max(released_values) if len(released_values) == len(rows) else None,
                tenant_isolated=bool(rows[0].rag_tenant_isolated),
                has_running_workflow_runs=bool(has_running),
            )

    @override
    def list_reconcilable_groups(self, *, limit: int) -> Sequence[RagPipelineHandoffGroupIdentity]:
        if limit <= 0:
            raise ValueError("limit must be positive")
        latest = WorkflowRunHandoff.__table__.alias("latest_rag_handoff")
        failed_document_pending = and_(
            WorkflowRunHandoff.state == WorkflowHandoffState.FAILED,
            WorkflowRunHandoff.rag_document_id.is_not(None),
            WorkflowRunHandoff.rag_document_error_marked_at.is_(None),
            ~exists(
                select(1).where(
                    latest.c.workflow_run_id == WorkflowRunHandoff.workflow_run_id,
                    latest.c.generation > WorkflowRunHandoff.generation,
                )
            ),
        )
        candidates = (
            select(
                WorkflowRunHandoff.rag_source_batch_id,
                WorkflowRunHandoff.rag_tenant_id,
                WorkflowRunHandoff.rag_queue_kind,
            )
            .where(
                WorkflowRunHandoff.rag_source_batch_id.is_not(None),
                WorkflowRunHandoff.rag_tenant_id.is_not(None),
                WorkflowRunHandoff.rag_queue_kind.is_not(None),
                or_(
                    and_(
                        WorkflowRunHandoff.rag_group_sealed_at.is_not(None),
                        or_(WorkflowRunHandoff.rag_tenant_slot_released_at.is_(None), failed_document_pending),
                    ),
                    WorkflowRunHandoff.rag_group_sealed_at.is_(None),
                ),
            )
            .distinct()
            .subquery("rag_handoff_group_candidates")
        )
        group_member = WorkflowRunHandoff.__table__.alias("rag_handoff_group_member")
        group_run = WorkflowRun.__table__.alias("rag_handoff_group_run")
        group_has_running_run = exists(
            select(1)
            .select_from(group_member.join(group_run, group_run.c.id == group_member.c.workflow_run_id))
            .where(
                group_member.c.rag_source_batch_id == candidates.c.rag_source_batch_id,
                group_member.c.rag_tenant_id == candidates.c.rag_tenant_id,
                group_member.c.rag_queue_kind == candidates.c.rag_queue_kind,
                group_run.c.status == WorkflowExecutionStatus.RUNNING,
            )
        )
        stmt = (
            select(
                candidates.c.rag_source_batch_id,
                candidates.c.rag_tenant_id,
                candidates.c.rag_queue_kind,
            )
            .order_by(
                group_has_running_run,
                candidates.c.rag_source_batch_id,
                candidates.c.rag_tenant_id,
                candidates.c.rag_queue_kind,
            )
            .limit(limit)
        )
        with self._session_factory() as session:
            return [
                RagPipelineHandoffGroupIdentity(
                    source_batch_id=cast(str, source_batch_id),
                    tenant_id=cast(str, tenant_id),
                    queue_kind=queue_kind,
                )
                for source_batch_id, tenant_id, queue_kind in session.execute(stmt).tuples()
            ]

    @override
    def mark_failed_documents(self, *, identity: RagPipelineHandoffGroupIdentity, marked_at: datetime) -> int:
        newer = WorkflowRunHandoff.__table__.alias("newer_rag_handoff")
        latest_generation = ~exists(
            select(1).where(
                newer.c.workflow_run_id == WorkflowRunHandoff.workflow_run_id,
                newer.c.generation > WorkflowRunHandoff.generation,
            )
        )
        with self._session_factory.begin() as session:
            failed_rows = list(
                session.scalars(
                    select(WorkflowRunHandoff)
                    .where(
                        *self._group_filters(identity),
                        latest_generation,
                        WorkflowRunHandoff.state == WorkflowHandoffState.FAILED,
                        WorkflowRunHandoff.rag_document_id.is_not(None),
                        WorkflowRunHandoff.rag_document_error_marked_at.is_(None),
                    )
                    .order_by(WorkflowRunHandoff.workflow_run_id, WorkflowRunHandoff.generation)
                    .with_for_update()
                )
            )
            if not failed_rows:
                return 0
            document_ids = sorted({cast(str, row.rag_document_id) for row in failed_rows})
            dataset_ids = sorted({cast(str, row.rag_dataset_id) for row in failed_rows})
            documents = {
                (document.dataset_id, document.id): document
                for document in session.scalars(
                    select(Document)
                    .where(
                        Document.id.in_(document_ids),
                        Document.dataset_id.in_(dataset_ids),
                        Document.tenant_id == identity.tenant_id,
                    )
                    .order_by(Document.id)
                    .with_for_update()
                )
            }
            for row in failed_rows:
                document = documents.get((cast(str, row.rag_dataset_id), cast(str, row.rag_document_id)))
                if document is not None and document.indexing_status != IndexingStatus.COMPLETED:
                    document.indexing_status = IndexingStatus.ERROR
                    document.error = row.last_error or "RAG pipeline handoff permanently failed"
                    document.stopped_at = marked_at
                row.rag_document_error_marked_at = marked_at
            session.flush()
            return len(failed_rows)

    @override
    def mark_released_once(self, *, identity: RagPipelineHandoffGroupIdentity, released_at: datetime) -> bool:
        with self._session_factory.begin() as session:
            rows = self._locked_group_rows(session, identity)
            if not rows or any(row.rag_tenant_slot_released_at is not None for row in rows):
                return False
            if any(row.rag_group_sealed_at is None for row in rows):
                return False
            run_ids = sorted({row.workflow_run_id for row in rows})
            has_running = session.scalar(
                select(
                    exists().where(
                        WorkflowRun.id.in_(run_ids),
                        WorkflowRun.status == WorkflowExecutionStatus.RUNNING,
                    )
                )
            )
            if has_running:
                return False
            for row in rows:
                row.rag_tenant_slot_released_at = released_at
            session.flush()
            return True

    @staticmethod
    def _group_filters(identity: RagPipelineHandoffGroupIdentity):
        return (
            WorkflowRunHandoff.rag_source_batch_id == identity.source_batch_id,
            WorkflowRunHandoff.rag_tenant_id == identity.tenant_id,
            WorkflowRunHandoff.rag_queue_kind == identity.queue_kind,
        )

    def _locked_group_rows(
        self, session: Session, identity: RagPipelineHandoffGroupIdentity
    ) -> list[WorkflowRunHandoff]:
        rows = list(
            session.scalars(
                select(WorkflowRunHandoff)
                .where(*self._group_filters(identity))
                .order_by(WorkflowRunHandoff.workflow_run_id, WorkflowRunHandoff.generation)
                .with_for_update()
            )
        )
        self._validate_group_rows(rows)
        return rows

    @staticmethod
    def _validate_group_rows(rows: Sequence[WorkflowRunHandoff]) -> None:
        isolation_values = {row.rag_tenant_isolated for row in rows}
        if None in isolation_values or len(isolation_values) > 1:
            raise RuntimeError("RAG handoff group has inconsistent tenant isolation metadata")
        dataset_values = {row.rag_dataset_id for row in rows}
        if None in dataset_values or len(dataset_values) > 1:
            raise RuntimeError("RAG handoff group has inconsistent dataset ownership metadata")


__all__ = [
    "RagPipelineHandoffGroupRepository",
    "RagPipelineHandoffGroupSnapshot",
    "SQLAlchemyRagPipelineHandoffGroupRepository",
]
