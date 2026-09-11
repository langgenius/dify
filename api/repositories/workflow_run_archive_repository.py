"""Database repository for workflow-run archive bundle queries."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.workflow import WorkflowRunArchiveBundle
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveBundleQuery,
    WorkflowRunArchiveBundleRecord,
)


class WorkflowRunArchiveBundleQueryRepository(WorkflowRunArchiveBundleQuery):
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
            )
            for row in rows
        )
