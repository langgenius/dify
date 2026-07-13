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

from sqlalchemy import select
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
    download_task: WorkflowRunArchiveDownloadTask | None


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


def list_workflow_run_archives(
    session: Session,
    tenant_id: str,
    *,
    cache: WorkflowRunArchiveDownloadTaskCache | None = None,
) -> WorkflowRunArchiveList:
    """Return monthly archive metadata for one tenant from the DB bundle index."""
    stmt = (
        select(WorkflowRunArchiveBundle)
        .where(WorkflowRunArchiveBundle.tenant_id == tenant_id)
        .order_by(
            WorkflowRunArchiveBundle.year.desc(),
            WorkflowRunArchiveBundle.month.desc(),
            WorkflowRunArchiveBundle.shard,
            WorkflowRunArchiveBundle.bundle_id,
        )
    )
    month_bundles: dict[tuple[int, int], list[WorkflowRunArchiveBundle]] = {}
    for bundle in session.scalars(stmt):
        month_bundles.setdefault((bundle.year, bundle.month), []).append(bundle)

    task_cache = cache or WorkflowRunArchiveDownloadTaskCache()
    months: list[WorkflowRunArchiveMonth] = []
    for (year, month), bundles in month_bundles.items():
        bundle_refs = [(bundle.shard, bundle.bundle_id) for bundle in bundles]
        months.append(
            WorkflowRunArchiveMonth(
                year=year,
                month=month,
                bundle_count=len(bundles),
                workflow_run_count=sum(bundle.workflow_run_count for bundle in bundles),
                row_count=sum(bundle.row_count for bundle in bundles),
                archive_bytes=sum(bundle.archive_bytes for bundle in bundles),
                latest_archived_at=max(bundle.archived_at for bundle in bundles),
                download_task=_get_cached_month_download_task(
                    task_cache,
                    tenant_id=tenant_id,
                    year=year,
                    month=month,
                    bundle_refs=bundle_refs,
                ),
            )
        )
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


def _get_cached_month_download_task(
    cache: WorkflowRunArchiveDownloadTaskCache,
    *,
    tenant_id: str,
    year: int,
    month: int,
    bundle_refs: list[tuple[str, str]],
) -> WorkflowRunArchiveDownloadTask | None:
    if not bundle_refs:
        return None
    download_id = build_archive_download_id(
        tenant_id=tenant_id,
        year=year,
        month=month,
        bundle_refs=bundle_refs,
    )
    try:
        return cache.get(tenant_id=tenant_id, download_id=download_id)
    except Exception:
        logger.warning("Failed to read cached workflow run archive download task: %s", download_id, exc_info=True)
        return None


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
    with task_cache.lock(tenant_id=tenant_id, download_id=download_id):
        existing = task_cache.get(tenant_id=tenant_id, download_id=download_id)
        if existing is None or existing.status == WorkflowRunArchiveDownloadStatus.FAILED:
            task_to_queue = task
        elif existing.status == WorkflowRunArchiveDownloadStatus.PENDING and not existing.celery_task_id:
            task_to_queue = existing
        else:
            return existing

        queued_task = task_to_queue.model_copy(
            update={"celery_task_id": uuid.uuid4().hex, "updated_at": datetime.datetime.now(datetime.UTC)}
        )
        task_cache.save(queued_task)

    return dispatch(queued_task, task_cache)


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
    Enqueue background ZIP preparation after the caller atomically claimed and cached the Celery id.
    """
    from tasks.workflow_run_archive_download_tasks import prepare_workflow_run_archive_download_task

    celery_task_id = task.celery_task_id
    if celery_task_id is None:
        raise ValueError("celery_task_id is required before dispatch")

    try:
        prepare_workflow_run_archive_download_task.apply_async(
            args=(task.tenant_id, task.download_id),
            task_id=celery_task_id,
        )
    except Exception:
        failure_time = datetime.datetime.now(datetime.UTC)
        failed_task = task.model_copy(
            update={
                "status": WorkflowRunArchiveDownloadStatus.FAILED,
                "error": "Failed to enqueue archive download task.",
                "updated_at": failure_time,
                "finished_at": failure_time,
            }
        )
        with cache.lock(tenant_id=task.tenant_id, download_id=task.download_id):
            current = cache.get(tenant_id=task.tenant_id, download_id=task.download_id)
            if (
                current is not None
                and current.status == WorkflowRunArchiveDownloadStatus.PENDING
                and current.celery_task_id == celery_task_id
            ):
                cache.save(failed_task)
                current = failed_task
        logger.exception("Failed to enqueue workflow run archive download task %s", task.download_id)
        return current or failed_task

    return task
