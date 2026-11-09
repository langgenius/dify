"""Tenant-scoped queries and deletion requests for workflow-run archive bundles."""

from collections.abc import Sequence
from typing import override

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from models.workflow import WorkflowRunArchiveBundle
from services.retention.workflow_run.archive_deletion_task import WorkflowRunArchiveDeletionStatus
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveBundleRecord,
    WorkflowRunArchiveBundleStore,
)


class WorkflowRunArchiveBundleQueryRepository(WorkflowRunArchiveBundleStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def list_for_tenant(self, tenant_id: str) -> tuple[WorkflowRunArchiveBundleRecord, ...]:
        stmt = (
            select(
                WorkflowRunArchiveBundle.year,
                WorkflowRunArchiveBundle.month,
                WorkflowRunArchiveBundle.shard,
                WorkflowRunArchiveBundle.bundle_id,
                WorkflowRunArchiveBundle.workflow_run_count,
                WorkflowRunArchiveBundle.row_count,
                WorkflowRunArchiveBundle.archive_bytes,
                WorkflowRunArchiveBundle.archived_at,
                WorkflowRunArchiveBundle.deletion_status,
                WorkflowRunArchiveBundle.id,
            )
            .where(WorkflowRunArchiveBundle.tenant_id == tenant_id)
            .order_by(
                WorkflowRunArchiveBundle.year.desc(),
                WorkflowRunArchiveBundle.month.desc(),
                WorkflowRunArchiveBundle.shard,
                WorkflowRunArchiveBundle.bundle_id,
            )
        )
        with self._session_factory() as session:
            rows = session.execute(stmt).all()

        return tuple(
            WorkflowRunArchiveBundleRecord(
                year=row.year,
                month=row.month,
                shard=row.shard,
                bundle_id=row.bundle_id,
                workflow_run_count=row.workflow_run_count,
                row_count=row.row_count,
                archive_bytes=row.archive_bytes,
                archived_at=row.archived_at,
                deletion_status=WorkflowRunArchiveDeletionStatus(row.deletion_status) if row.deletion_status else None,
                catalog_id=row.id,
            )
            for row in rows
        )

    @override
    def list_for_tenant_month(
        self,
        tenant_id: str,
        *,
        year: int,
        month: int,
    ) -> tuple[WorkflowRunArchiveBundleRecord, ...]:
        stmt = (
            select(
                WorkflowRunArchiveBundle.year,
                WorkflowRunArchiveBundle.month,
                WorkflowRunArchiveBundle.shard,
                WorkflowRunArchiveBundle.bundle_id,
                WorkflowRunArchiveBundle.workflow_run_count,
                WorkflowRunArchiveBundle.row_count,
                WorkflowRunArchiveBundle.archive_bytes,
                WorkflowRunArchiveBundle.archived_at,
                WorkflowRunArchiveBundle.deletion_status,
                WorkflowRunArchiveBundle.id,
            )
            .where(
                WorkflowRunArchiveBundle.tenant_id == tenant_id,
                WorkflowRunArchiveBundle.year == year,
                WorkflowRunArchiveBundle.month == month,
            )
            .order_by(WorkflowRunArchiveBundle.shard, WorkflowRunArchiveBundle.bundle_id)
        )
        with self._session_factory() as session:
            rows = session.execute(stmt).all()

        return tuple(
            WorkflowRunArchiveBundleRecord(
                year=row.year,
                month=row.month,
                shard=row.shard,
                bundle_id=row.bundle_id,
                workflow_run_count=row.workflow_run_count,
                row_count=row.row_count,
                archive_bytes=row.archive_bytes,
                archived_at=row.archived_at,
                deletion_status=WorkflowRunArchiveDeletionStatus(row.deletion_status) if row.deletion_status else None,
                catalog_id=row.id,
            )
            for row in rows
        )

    @override
    def request_deletion(self, tenant_id: str, *, year: int, month: int) -> WorkflowRunArchiveDeletionStatus | None:
        """Commit the safety marker under the same row locks used by source-row maintenance."""
        with self._session_factory.begin() as session:
            bundles = session.scalars(
                select(WorkflowRunArchiveBundle)
                .where(
                    WorkflowRunArchiveBundle.tenant_id == tenant_id,
                    WorkflowRunArchiveBundle.year == year,
                    WorkflowRunArchiveBundle.month == month,
                )
                .order_by(WorkflowRunArchiveBundle.id)
                .with_for_update()
            ).all()
            for bundle in bundles:
                if bundle.deletion_status in (None, WorkflowRunArchiveDeletionStatus.FAILED):
                    bundle.deletion_status = WorkflowRunArchiveDeletionStatus.PENDING
            if not bundles:
                return None
            if any(bundle.deletion_status == WorkflowRunArchiveDeletionStatus.PROCESSING for bundle in bundles):
                return WorkflowRunArchiveDeletionStatus.PROCESSING
            return WorkflowRunArchiveDeletionStatus.PENDING

    @override
    def set_deletion_status(
        self, tenant_id: str, *, year: int, month: int, status: WorkflowRunArchiveDeletionStatus
    ) -> None:
        with self._session_factory.begin() as session:
            session.execute(
                update(WorkflowRunArchiveBundle)
                .where(
                    WorkflowRunArchiveBundle.tenant_id == tenant_id,
                    WorkflowRunArchiveBundle.year == year,
                    WorkflowRunArchiveBundle.month == month,
                    WorkflowRunArchiveBundle.deletion_status.is_not(None),
                )
                .values(deletion_status=status)
            )

    @override
    def remove_deleted_bundles(self, tenant_id: str, *, catalog_ids: Sequence[str]) -> None:
        """Remove only requested bundle indexes after their object-store deletion succeeds."""
        if not catalog_ids:
            return
        with self._session_factory.begin() as session:
            for offset in range(0, len(catalog_ids), 1000):
                session.execute(
                    delete(WorkflowRunArchiveBundle).where(
                        WorkflowRunArchiveBundle.tenant_id == tenant_id,
                        WorkflowRunArchiveBundle.id.in_(catalog_ids[offset : offset + 1000]),
                        WorkflowRunArchiveBundle.deletion_status.is_not(None),
                    )
                )
