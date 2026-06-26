"""
Console-facing workflow-run archive queries.

The object store remains the recoverable archive source of truth. This module only reads the DB bundle index and writes
temporary Redis download-task state, so console requests never list R2 online.
"""

import datetime
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.workflow import WorkflowRunArchiveBundle
from services.retention.workflow_run.archive_download_task_cache import (
    WorkflowRunArchiveDownloadTask,
    WorkflowRunArchiveDownloadTaskCache,
    build_archive_download_id,
    build_pending_archive_download_task,
)


@dataclass(frozen=True)
class WorkflowRunArchiveMonth:
    """Aggregated archive metadata for one tenant/month."""

    year: int
    month: int
    bundle_count: int
    workflow_run_count: int
    row_count: int
    archive_bytes: int
    latest_archived_at: datetime.datetime


@dataclass(frozen=True)
class WorkflowRunArchiveSummary:
    """Top-level archive totals shown on the console page."""

    archived_month_count: int
    workflow_run_count: int
    archive_bytes: int
    latest_archived_at: datetime.datetime | None


@dataclass(frozen=True)
class WorkflowRunArchiveList:
    """Console response model before controller serialization."""

    summary: WorkflowRunArchiveSummary
    months: list[WorkflowRunArchiveMonth]


class WorkflowRunArchiveNotFoundError(Exception):
    """Raised when no archive bundles exist for a requested tenant/month."""


class WorkflowRunArchiveDownloadTaskNotFoundError(Exception):
    """Raised when the temporary Redis task has expired or never existed."""


def list_workflow_run_archives(session: Session, tenant_id: str) -> WorkflowRunArchiveList:
    """Return monthly archive metadata for one tenant from the DB bundle index."""
    stmt = (
        select(
            WorkflowRunArchiveBundle.year.label("year"),
            WorkflowRunArchiveBundle.month.label("month"),
            func.count(WorkflowRunArchiveBundle.id).label("bundle_count"),
            func.coalesce(func.sum(WorkflowRunArchiveBundle.workflow_run_count), 0).label("workflow_run_count"),
            func.coalesce(func.sum(WorkflowRunArchiveBundle.row_count), 0).label("row_count"),
            func.coalesce(func.sum(WorkflowRunArchiveBundle.archive_bytes), 0).label("archive_bytes"),
            func.max(WorkflowRunArchiveBundle.archived_at).label("latest_archived_at"),
        )
        .where(WorkflowRunArchiveBundle.tenant_id == tenant_id)
        .group_by(WorkflowRunArchiveBundle.year, WorkflowRunArchiveBundle.month)
        .order_by(WorkflowRunArchiveBundle.year.desc(), WorkflowRunArchiveBundle.month.desc())
    )
    months = [
        WorkflowRunArchiveMonth(
            year=int(row.year),
            month=int(row.month),
            bundle_count=int(row.bundle_count),
            workflow_run_count=int(row.workflow_run_count),
            row_count=int(row.row_count),
            archive_bytes=int(row.archive_bytes),
            latest_archived_at=row.latest_archived_at,
        )
        for row in session.execute(stmt)
        if row.latest_archived_at is not None
    ]
    latest_archived_at = max((month.latest_archived_at for month in months), default=None)
    return WorkflowRunArchiveList(
        summary=WorkflowRunArchiveSummary(
            archived_month_count=len(months),
            workflow_run_count=sum(month.workflow_run_count for month in months),
            archive_bytes=sum(month.archive_bytes for month in months),
            latest_archived_at=latest_archived_at,
        ),
        months=months,
    )


def create_workflow_run_archive_download_task(
    session: Session,
    *,
    tenant_id: str,
    requested_by: str,
    year: int,
    month: int,
    cache: WorkflowRunArchiveDownloadTaskCache | None = None,
) -> WorkflowRunArchiveDownloadTask:
    """
    Create or return the idempotent Redis task for downloading one tenant/month archive.

    The task identity is based on the exact ordered bundle set currently indexed for the month. If the month receives a
    new bundle later, the next request gets a different download id and prepares a fresh file.
    """
    bundles = _list_archive_bundles(session, tenant_id=tenant_id, year=year, month=month)
    if not bundles:
        raise WorkflowRunArchiveNotFoundError(f"Workflow run archive not found: {year:04d}-{month:02d}")

    bundle_refs = [(bundle.shard, bundle.bundle_id) for bundle in bundles]
    download_id = build_archive_download_id(
        tenant_id=tenant_id,
        year=year,
        month=month,
        bundle_refs=bundle_refs,
    )
    task = build_pending_archive_download_task(
        tenant_id=tenant_id,
        requested_by=requested_by,
        year=year,
        month=month,
        bundle_ids=[bundle.bundle_id for bundle in bundles],
        archive_bytes=sum(bundle.archive_bytes for bundle in bundles),
        download_id=download_id,
    )
    task_cache = cache or WorkflowRunArchiveDownloadTaskCache()
    if task_cache.create_if_absent(task):
        return task

    existing = task_cache.get(tenant_id=tenant_id, download_id=download_id)
    if existing is not None:
        return existing

    task_cache.save(task)
    return task


def get_workflow_run_archive_download_task(
    *,
    tenant_id: str,
    download_id: str,
    cache: WorkflowRunArchiveDownloadTaskCache | None = None,
) -> WorkflowRunArchiveDownloadTask:
    """Return a cached archive download task or raise when the TTL has expired."""
    task_cache = cache or WorkflowRunArchiveDownloadTaskCache()
    task = task_cache.get(tenant_id=tenant_id, download_id=download_id)
    if task is None:
        raise WorkflowRunArchiveDownloadTaskNotFoundError(f"Workflow run archive download not found: {download_id}")
    return task


def _list_archive_bundles(
    session: Session,
    *,
    tenant_id: str,
    year: int,
    month: int,
) -> list[WorkflowRunArchiveBundle]:
    stmt = (
        select(WorkflowRunArchiveBundle)
        .where(
            WorkflowRunArchiveBundle.tenant_id == tenant_id,
            WorkflowRunArchiveBundle.year == year,
            WorkflowRunArchiveBundle.month == month,
        )
        .order_by(WorkflowRunArchiveBundle.shard, WorkflowRunArchiveBundle.bundle_id)
    )
    return list(session.scalars(stmt))
