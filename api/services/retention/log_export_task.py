"""Temporary CSV export tasks and their lifecycle, shared by Console applications."""

import logging
from collections.abc import Callable, Generator
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Literal, Protocol, Self, TextIO
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from libs.datetime_utils import utc_now
from machinery.context import RequestContext

_LOG_EXPORT_TASK_TTL = timedelta(days=1)
_LOG_EXPORT_DOWNLOAD_URL_TTL_SECONDS = 3600
logger = logging.getLogger(__name__)

type StoreLogExportFile = Callable[[str, Callable[[TextIO], int]], None]
type LogExportDownload = str | tuple[bytes, Generator[bytes]]
type OpenLogExportFile = Callable[[str, int, str], LogExportDownload]
type LogExportKind = Literal["conversation", "workflow"]


class LogExportStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class LogExportTaskNotFoundError(Exception):
    """The task is unavailable for the admitted app."""


class LogExportTaskNotReadyError(Exception):
    """The admitted task has no completed CSV."""


class LogExportFileNotFoundError(Exception):
    """The completed export's CSV could not be opened."""


class LogExportTask[FiltersT](BaseModel):
    """Persist the admitted owner, normalized filters and state of a temporary export."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    task_id: str
    tenant_id: str
    app_id: str
    requested_by: str
    filters: FiltersT
    created_at: datetime
    expires_at: datetime
    status: LogExportStatus = LogExportStatus.PENDING
    storage_key: str | None = None

    @classmethod
    def pending(cls, *, tenant_id: str, app_id: str, requested_by: str, filters: FiltersT) -> Self:
        """Build a fresh pending task with UTC filters and a one-day expiration."""
        created_at = utc_now()
        return cls(
            task_id=str(uuid4()),
            tenant_id=tenant_id,
            app_id=app_id,
            requested_by=requested_by,
            filters=filters,
            created_at=created_at,
            expires_at=created_at + _LOG_EXPORT_TASK_TTL,
        )


def open_ready_log_export_csv[FiltersT](
    task: LogExportTask[FiltersT], *, open_csv: OpenLogExportFile, filename: str
) -> LogExportDownload:
    """Open an admitted, unexpired export after verifying its completed file and bounding the URL lifetime."""
    if task.status is not LogExportStatus.READY or not task.storage_key:
        raise LogExportTaskNotReadyError()
    remaining_seconds = int((task.expires_at - utc_now()).total_seconds())
    if remaining_seconds < 1:
        raise LogExportTaskNotFoundError()
    expires_in = min(_LOG_EXPORT_DOWNLOAD_URL_TTL_SECONDS, remaining_seconds)
    return open_csv(task.storage_key, expires_in, filename)


class LogExportTaskStore[FiltersT](Protocol):
    def save(self, task: LogExportTask[FiltersT]) -> None:
        """Persist a new task and remember it as its requester's latest for the app."""
        ...

    def get(self, *, tenant_id: str, app_id: str, task_id: str) -> LogExportTask[FiltersT] | None:
        """Return a live task for the exact workspace and app, or None if absent or expired."""
        ...

    def get_latest(self, *, tenant_id: str, app_id: str, requested_by: str) -> LogExportTask[FiltersT] | None:
        """Return the requester's latest live task for this app, or None if unavailable."""
        ...

    def transition(self, task: LogExportTask[FiltersT], *, from_status: LogExportStatus) -> bool:
        """Replace a live task only from the expected status, keeping its original expiration."""
        ...


class WriteLogExportCsv[FiltersT](Protocol):
    def __call__(self, context: RequestContext, app_id: str, /, *, filters: FiltersT, output: TextIO) -> int:
        """Resolve the app within the saved workspace and write the matching rows to the open file."""
        ...


def save_and_dispatch_log_export_task[FiltersT](
    task: LogExportTask[FiltersT],
    *,
    tasks: LogExportTaskStore[FiltersT],
    dispatch: Callable[[LogExportTask[FiltersT]], None],
) -> None:
    """Persist an admitted pending task before publishing it. Record a failure if it remains pending."""
    try:
        tasks.save(task)
        dispatch(task)
    except Exception:
        _mark_failed(task, tasks)
        raise


def prepare_log_export_task[FiltersT](
    task: LogExportTask[FiltersT] | None,
    *,
    tasks: LogExportTaskStore[FiltersT],
    storage_prefix: str,
    store_csv: StoreLogExportFile,
    write_csv: WriteLogExportCsv[FiltersT],
) -> None:
    """Claim a live pending task scoped by the store and mark it ready only after uploading the CSV.

    Leave absent and already claimed tasks alone. Record preparation failures before propagating them.
    """
    if task is None or task.status is not LogExportStatus.PENDING:
        return
    processing = task.model_copy(update={"status": LogExportStatus.PROCESSING})
    if not tasks.transition(processing, from_status=LogExportStatus.PENDING):
        return

    context = RequestContext(
        request_id=task.task_id, trace_id=None, account_id=task.requested_by, active_workspace_id=task.tenant_id
    )
    storage_key = f"{storage_prefix}/{task.tenant_id}/{task.app_id}/{task.task_id}.csv"
    try:
        store_csv(storage_key, lambda output: write_csv(context, task.app_id, filters=task.filters, output=output))
        ready = processing.model_copy(update={"status": LogExportStatus.READY, "storage_key": storage_key})
        tasks.transition(ready, from_status=LogExportStatus.PROCESSING)
    except Exception:
        _mark_failed(processing, tasks)
        raise


def _mark_failed[FiltersT](task: LogExportTask[FiltersT], tasks: LogExportTaskStore[FiltersT]) -> None:
    """Record failure from the last owned state while preserving the original exception."""
    try:
        tasks.transition(task.model_copy(update={"status": LogExportStatus.FAILED}), from_status=task.status)
    except Exception:
        logger.exception(
            "Failed to record log export failure: tenant=%s app=%s task=%s", task.tenant_id, task.app_id, task.task_id
        )
