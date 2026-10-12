"""Application service for Console workflow-run archive downloads."""

import datetime
import logging
import uuid
from collections.abc import Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Any, NamedTuple, Protocol

from machinery.context import RequestContext
from services.retention.workflow_run.archive_deletion_task import (
    WorkflowRunArchiveDeletionDispatcher,
    WorkflowRunArchiveDeletionStatus,
    WorkflowRunArchiveDeletionTask,
)
from services.retention.workflow_run.archive_download_task import (
    WorkflowRunArchiveDownloadStatus,
    WorkflowRunArchiveDownloadTask,
    build_archive_download_id,
    build_pending_archive_download_task,
)

logger = logging.getLogger(__name__)


class WorkflowRunArchiveBundleRecord(NamedTuple):
    """Persistence-neutral metadata for one immutable archive bundle."""

    year: int
    month: int
    shard: str
    bundle_id: str
    workflow_run_count: int
    row_count: int
    archive_bytes: int
    archived_at: datetime.datetime
    deletion_status: WorkflowRunArchiveDeletionStatus | None = None
    catalog_id: str = ""


class WorkflowRunArchiveBundleQuery(Protocol):
    def list_for_tenant(self, tenant_id: str) -> Sequence[WorkflowRunArchiveBundleRecord]: ...

    def list_for_tenant_month(
        self,
        tenant_id: str,
        *,
        year: int,
        month: int,
    ) -> Sequence[WorkflowRunArchiveBundleRecord]: ...


class WorkflowRunArchiveBundleStore(WorkflowRunArchiveBundleQuery, Protocol):
    def request_deletion(self, tenant_id: str, *, year: int, month: int) -> WorkflowRunArchiveDeletionStatus | None: ...

    def set_deletion_status(
        self, tenant_id: str, *, year: int, month: int, status: WorkflowRunArchiveDeletionStatus
    ) -> None: ...

    def remove_deleted_bundles(self, tenant_id: str, *, catalog_ids: Sequence[str]) -> None: ...


class WorkflowRunArchiveDownloadTaskStore(Protocol):
    def get(self, *, tenant_id: str, download_id: str) -> WorkflowRunArchiveDownloadTask | None: ...

    def save(self, task: WorkflowRunArchiveDownloadTask) -> None: ...

    def lock(self, *, tenant_id: str, download_id: str) -> AbstractContextManager[Any]: ...


class WorkflowRunArchiveDownloadTaskDispatcher(Protocol):
    def __call__(self, task: WorkflowRunArchiveDownloadTask) -> None: ...


class WorkflowRunArchiveDownloadUrlSigner(Protocol):
    def __call__(
        self,
        storage_key: str,
        *,
        expires_in: int,
        filename: str,
    ) -> str: ...


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
    deletion_status: WorkflowRunArchiveDeletionStatus | None = None


@dataclass(frozen=True)
class WorkflowRunArchiveSummary:
    """Top-level archive totals shown on the Console page."""

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


class WorkflowRunArchiveInvalidMonthError(Exception):
    """Raised when a requested archive year or month is outside the supported range."""


class WorkflowRunArchiveDownloadTaskNotFoundError(Exception):
    """Raised when the temporary download task has expired or never existed."""


class WorkflowRunArchiveDownloadNotReadyError(Exception):
    """Raised when a cached download task has not produced a file yet."""


class WorkflowRunArchiveService:
    def __init__(
        self,
        *,
        bundles: WorkflowRunArchiveBundleStore,
        tasks: WorkflowRunArchiveDownloadTaskStore,
        dispatcher: WorkflowRunArchiveDownloadTaskDispatcher,
        sign_download_url: WorkflowRunArchiveDownloadUrlSigner,
        deletion_dispatcher: WorkflowRunArchiveDeletionDispatcher,
    ) -> None:
        self._bundles = bundles
        self._tasks = tasks
        self._dispatcher = dispatcher
        self._sign_download_url = sign_download_url
        self._deletion_dispatcher = deletion_dispatcher

    def list_archives(self, context: RequestContext) -> WorkflowRunArchiveList:
        """Return monthly archive metadata for the active workspace."""
        tenant_id = context.active_workspace_id
        records_by_month: dict[tuple[int, int], list[WorkflowRunArchiveBundleRecord]] = {}
        for record in self._bundles.list_for_tenant(tenant_id):
            records_by_month.setdefault((record.year, record.month), []).append(record)

        months: list[WorkflowRunArchiveMonth] = []
        for year, month in sorted(records_by_month, reverse=True):
            records = records_by_month[(year, month)]
            bundle_refs = [(record.shard, record.bundle_id) for record in records]
            deletion_status = _month_deletion_status(records)
            months.append(
                WorkflowRunArchiveMonth(
                    year=year,
                    month=month,
                    bundle_count=len(records),
                    workflow_run_count=sum(record.workflow_run_count for record in records),
                    row_count=sum(record.row_count for record in records),
                    archive_bytes=sum(record.archive_bytes for record in records),
                    latest_archived_at=max(record.archived_at for record in records),
                    download_task=None
                    if deletion_status
                    else self._get_cached_month_download_task(
                        tenant_id=tenant_id,
                        year=year,
                        month=month,
                        bundle_refs=bundle_refs,
                    ),
                    deletion_status=deletion_status,
                )
            )

        latest_archived_at = max((archive.latest_archived_at for archive in months), default=None)
        return WorkflowRunArchiveList(
            summary=WorkflowRunArchiveSummary(
                archived_month_count=len(months),
                workflow_run_count=sum(archive.workflow_run_count for archive in months),
                archive_bytes=sum(archive.archive_bytes for archive in months),
                latest_archived_at=latest_archived_at,
            ),
            months=months,
        )

    def create_download(
        self,
        context: RequestContext,
        *,
        year: int,
        month: int,
    ) -> WorkflowRunArchiveDownloadTask:
        """Create or return the idempotent download task for one workspace/month."""
        tenant_id = context.active_workspace_id
        bundles = self._bundles.list_for_tenant_month(tenant_id, year=year, month=month)
        if not bundles:
            raise WorkflowRunArchiveNotFoundError(f"Workflow run archive not found: {year:04d}-{month:02d}")
        if _month_deletion_status(bundles):
            raise WorkflowRunArchiveDownloadNotReadyError("This workflow run archive is being permanently deleted.")

        bundle_refs = [(bundle.shard, bundle.bundle_id) for bundle in bundles]
        download_id = build_archive_download_id(
            tenant_id=tenant_id,
            year=year,
            month=month,
            bundle_refs=bundle_refs,
        )
        task = build_pending_archive_download_task(
            tenant_id=tenant_id,
            requested_by=context.account_id,
            year=year,
            month=month,
            bundle_ids=[bundle.bundle_id for bundle in bundles],
            bundle_refs=bundle_refs,
            archive_bytes=sum(bundle.archive_bytes for bundle in bundles),
            download_id=download_id,
        )

        with self._tasks.lock(tenant_id=tenant_id, download_id=download_id):
            existing = self._tasks.get(tenant_id=tenant_id, download_id=download_id)
            if existing is None or existing.status == WorkflowRunArchiveDownloadStatus.FAILED:
                task_to_queue = task
            elif existing.status == WorkflowRunArchiveDownloadStatus.PENDING and not existing.celery_task_id:
                task_to_queue = existing
            else:
                return existing

            queued_task = task_to_queue.model_copy(
                update={"celery_task_id": uuid.uuid4().hex, "updated_at": datetime.datetime.now(datetime.UTC)}
            )
            self._tasks.save(queued_task)

        try:
            self._dispatcher(queued_task)
        except Exception:
            return self._record_dispatch_failure(queued_task)
        return queued_task

    def get_download(self, context: RequestContext, *, download_id: str) -> WorkflowRunArchiveDownloadTask:
        """Return a cached download task or raise after its TTL expires."""
        tenant_id = context.active_workspace_id
        task = self._tasks.get(tenant_id=tenant_id, download_id=download_id)
        if task is None:
            raise WorkflowRunArchiveDownloadTaskNotFoundError(f"Workflow run archive download not found: {download_id}")
        bundles = self._bundles.list_for_tenant_month(tenant_id, year=task.year, month=task.month)
        available_refs = {(bundle.shard, bundle.bundle_id) for bundle in bundles}
        requested_refs = {(ref.shard, ref.bundle_id) for ref in task.bundle_refs}
        available_ids = {bundle.bundle_id for bundle in bundles}
        if (
            task.tenant_id != tenant_id
            or _month_deletion_status(bundles)
            or not bundles
            or (requested_refs and not requested_refs.issubset(available_refs))
            or not set(task.bundle_ids).issubset(available_ids)
        ):
            raise WorkflowRunArchiveDownloadTaskNotFoundError("This workflow run archive is no longer available.")
        return task

    def delete_archive(self, context: RequestContext, *, year: int, month: int) -> WorkflowRunArchiveDeletionTask:
        """Durably disable downloads before enqueueing an idempotent archive-only deletion."""
        tenant_id = context.active_workspace_id
        status = self._bundles.request_deletion(tenant_id, year=year, month=month)
        if status is None:
            return WorkflowRunArchiveDeletionTask(year, month, WorkflowRunArchiveDeletionStatus.COMPLETED)
        try:
            # Re-dispatch pending/processing requests too: a lost or interrupted worker must be recoverable.
            self._deletion_dispatcher(tenant_id=tenant_id, year=year, month=month)
        except Exception:
            logger.exception("Failed to enqueue archive deletion: tenant=%s year=%s month=%s", tenant_id, year, month)
            self._bundles.set_deletion_status(
                tenant_id, year=year, month=month, status=WorkflowRunArchiveDeletionStatus.FAILED
            )
            return WorkflowRunArchiveDeletionTask(
                year, month, WorkflowRunArchiveDeletionStatus.FAILED, "Failed to enqueue archive deletion."
            )
        return WorkflowRunArchiveDeletionTask(year, month, status)

    def get_download_url(self, context: RequestContext, *, download_id: str) -> str:
        """Return a short-lived URL for a ready archive download."""
        task = self.get_download(context, download_id=download_id)
        if task.status != WorkflowRunArchiveDownloadStatus.READY or not task.storage_key or not task.file_name:
            raise WorkflowRunArchiveDownloadNotReadyError(f"Workflow run archive download is not ready: {download_id}")
        return self._sign_download_url(
            task.storage_key,
            expires_in=self._presigned_url_expires_in(task.expires_at),
            filename=task.file_name,
        )

    def _get_cached_month_download_task(
        self,
        *,
        tenant_id: str,
        year: int,
        month: int,
        bundle_refs: Sequence[tuple[str, str]],
    ) -> WorkflowRunArchiveDownloadTask | None:
        download_id = build_archive_download_id(
            tenant_id=tenant_id,
            year=year,
            month=month,
            bundle_refs=bundle_refs,
        )
        try:
            return self._tasks.get(tenant_id=tenant_id, download_id=download_id)
        except Exception:
            logger.warning("Failed to read cached workflow run archive download task: %s", download_id, exc_info=True)
            return None

    def _record_dispatch_failure(
        self,
        task: WorkflowRunArchiveDownloadTask,
    ) -> WorkflowRunArchiveDownloadTask:
        failure_time = datetime.datetime.now(datetime.UTC)
        failed_task = task.model_copy(
            update={
                "status": WorkflowRunArchiveDownloadStatus.FAILED,
                "error": "Failed to enqueue archive download task.",
                "updated_at": failure_time,
                "finished_at": failure_time,
            }
        )
        with self._tasks.lock(tenant_id=task.tenant_id, download_id=task.download_id):
            current = self._tasks.get(tenant_id=task.tenant_id, download_id=task.download_id)
            if (
                current is not None
                and current.status == WorkflowRunArchiveDownloadStatus.PENDING
                and current.celery_task_id == task.celery_task_id
            ):
                self._tasks.save(failed_task)
                current = failed_task
        logger.exception("Failed to enqueue workflow run archive download task %s", task.download_id)
        return current or failed_task

    @staticmethod
    def _presigned_url_expires_in(expires_at: datetime.datetime) -> int:
        expires_at_utc = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=datetime.UTC)
        remaining_seconds = int((expires_at_utc - datetime.datetime.now(datetime.UTC)).total_seconds())
        return max(1, min(3600, remaining_seconds))


def _month_deletion_status(
    records: Sequence[WorkflowRunArchiveBundleRecord],
) -> WorkflowRunArchiveDeletionStatus | None:
    """Any durable deletion request disables the entire month's downloads."""
    statuses = {record.deletion_status for record in records}
    for status in (
        WorkflowRunArchiveDeletionStatus.FAILED,
        WorkflowRunArchiveDeletionStatus.PROCESSING,
        WorkflowRunArchiveDeletionStatus.PENDING,
    ):
        if status in statuses:
            return status
    return None
