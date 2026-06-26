"""
Console-facing workflow-run archive queries.

The object store remains the recoverable archive source of truth. This module only reads the DB bundle index and writes
temporary Redis download-task state, so console requests never list R2 online.
"""

import datetime
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.workflow import WorkflowRunArchiveBundle
from services.retention.workflow_run.archive_download_task_cache import (
    WorkflowRunArchiveDownloadStatus,
    WorkflowRunArchiveDownloadTask,
    WorkflowRunArchiveDownloadTaskCache,
    build_archive_download_id,
    build_pending_archive_download_task,
)

logger = logging.getLogger(__name__)

ArchiveDownloadTaskDispatcher = Callable[
    [WorkflowRunArchiveDownloadTask, WorkflowRunArchiveDownloadTaskCache],
    WorkflowRunArchiveDownloadTask,
]


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


class WorkflowRunArchiveDownloadNotReadyError(Exception):
    """Raised when a cached download task has not produced a file yet."""


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
    dispatcher: ArchiveDownloadTaskDispatcher | None = None,
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
        bundle_refs=bundle_refs,
        archive_bytes=sum(bundle.archive_bytes for bundle in bundles),
        download_id=download_id,
    )
    task_cache = cache or WorkflowRunArchiveDownloadTaskCache()
    dispatch = dispatcher or _dispatch_workflow_run_archive_download_task
    if task_cache.create_if_absent(task):
        return dispatch(task, task_cache)

    existing = task_cache.get(tenant_id=tenant_id, download_id=download_id)
    if existing is not None:
        if existing.status == WorkflowRunArchiveDownloadStatus.FAILED:
            task_cache.save(task)
            return dispatch(task, task_cache)
        if existing.status == WorkflowRunArchiveDownloadStatus.PENDING and not existing.celery_task_id:
            return dispatch(existing, task_cache)
        return existing

    task_cache.save(task)
    return dispatch(task, task_cache)


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


def get_ready_workflow_run_archive_download_task(
    *,
    tenant_id: str,
    download_id: str,
    cache: WorkflowRunArchiveDownloadTaskCache | None = None,
) -> WorkflowRunArchiveDownloadTask:
    """Return a ready cached archive download task or raise when the file is not available."""
    task = get_workflow_run_archive_download_task(tenant_id=tenant_id, download_id=download_id, cache=cache)
    if task.status != WorkflowRunArchiveDownloadStatus.READY or not task.storage_key or not task.file_name:
        raise WorkflowRunArchiveDownloadNotReadyError(f"Workflow run archive download is not ready: {download_id}")
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


def _dispatch_workflow_run_archive_download_task(
    task: WorkflowRunArchiveDownloadTask,
    cache: WorkflowRunArchiveDownloadTaskCache,
) -> WorkflowRunArchiveDownloadTask:
    """
    Enqueue background ZIP preparation and persist the Celery id before the worker can start.

    The Redis task key is the idempotency boundary. We generate the Celery id in the API process, save it on the task,
    then submit with that exact id so duplicate console requests keep seeing one logical download request.
    """
    from tasks.workflow_run_archive_download_tasks import prepare_workflow_run_archive_download_task

    now = datetime.datetime.now(datetime.UTC)
    celery_task_id = uuid.uuid4().hex
    queued_task = task.model_copy(update={"celery_task_id": celery_task_id, "updated_at": now})
    cache.save(queued_task)

    try:
        prepare_workflow_run_archive_download_task.apply_async(
            args=[queued_task.tenant_id, queued_task.download_id],
            task_id=celery_task_id,
        )
    except Exception:
        failure_time = datetime.datetime.now(datetime.UTC)
        failed_task = queued_task.model_copy(
            update={
                "status": WorkflowRunArchiveDownloadStatus.FAILED,
                "error": "Failed to enqueue archive download task.",
                "updated_at": failure_time,
                "finished_at": failure_time,
            }
        )
        cache.save(failed_task)
        logger.exception("Failed to enqueue workflow run archive download task %s", queued_task.download_id)
        return failed_task

    return queued_task
