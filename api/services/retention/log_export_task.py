"""Temporary CSV export tasks and their lifecycle, shared by Console applications."""

import logging
from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import datetime, timedelta
from enum import StrEnum
from threading import Event, Thread
from typing import Protocol, Self, TextIO
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from libs.datetime_utils import utc_now
from machinery.context import RequestContext

_LOG_EXPORT_TASK_TTL = timedelta(days=1)
_LOG_EXPORT_DOWNLOAD_URL_TTL_SECONDS = 3600
_LOG_EXPORT_LEASE_RENEW_SECONDS = 30
logger = logging.getLogger(__name__)

type StoreLogExportFile = Callable[[str, Callable[[TextIO], int]], int]
type LogExportDownload = str | tuple[bytes, Generator[bytes]]
type OpenLogExportFile = Callable[[str, int, str], LogExportDownload]


class LogExportKind(StrEnum):
    CONVERSATION = "conversation"
    WORKFLOW = "workflow"
    AGENT = "agent"


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


class LogExportLimitReachedError(Exception):
    """The requester already has an active export or the workspace is at capacity."""


class LogExportLeaseBusyError(Exception):
    """The worker should retry because task state or lease ownership cannot be confirmed."""


class LogExportTask[FiltersT](BaseModel):
    """Persist an admitted export's state and carry its lease token only in the owning worker."""

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
    attempt: int = 0
    claim_token: str | None = Field(default=None, exclude=True, repr=False)

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
        """Atomically reserve capacity and save the pending task, accepting a replay for the same ID."""
        ...

    def get(self, *, tenant_id: str, app_id: str, task_id: str) -> LogExportTask[FiltersT] | None:
        """Load the scoped live task or None if absent or expired. Signal retry on temporary unavailability."""
        ...

    def get_latest(self, *, tenant_id: str, app_id: str, requested_by: str) -> LogExportTask[FiltersT] | None:
        """Return the requester's latest live task for this app, or None if unavailable."""
        ...

    def claim(self, task: LogExportTask[FiltersT]) -> LogExportTask[FiltersT] | None:
        """Return an owned attempt, retry if another claim changed it, or return None for a terminal task."""
        ...

    def renew(self, task: LogExportTask[FiltersT]) -> bool:
        """Extend an owned lease, returning False on loss or raising LogExportLeaseBusyError if unavailable."""
        ...

    def finish(self, task: LogExportTask[FiltersT], *, status: LogExportStatus, storage_key: str | None = None) -> bool:
        """Publish and release capacity if owned, return False on loss, or raise on a write error."""
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
    tasks.save(task)
    try:
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
    """Prepare a leased attempt, publishing its own CSV only while it still owns the task."""
    if task is None or task.status not in (LogExportStatus.PENDING, LogExportStatus.PROCESSING):
        return
    processing = tasks.claim(task)
    if processing is None:
        return

    context = RequestContext(
        request_id=task.task_id, trace_id=None, account_id=task.requested_by, active_workspace_id=task.tenant_id
    )
    # A stale attempt can only upload to its own key.
    storage_key = f"{storage_prefix}/{task.tenant_id}/{task.app_id}/{task.task_id}/{processing.attempt}.csv"

    def write_owned_csv(output: TextIO) -> int:
        """Generate the CSV and confirm ownership immediately before upload."""
        count = write_csv(context, task.app_id, filters=task.filters, output=output)
        if not tasks.renew(processing):
            raise LogExportLeaseBusyError("The log export lease expired before upload.")
        return count

    with _renew_export_lease(processing, tasks):
        try:
            store_csv(storage_key, write_owned_csv)
        except LogExportLeaseBusyError:
            raise
        except Exception as exc:
            if _mark_failed(processing, tasks) is False:
                raise LogExportLeaseBusyError("The log export attempt no longer owns its lease.") from exc
            raise
        if not tasks.finish(processing, status=LogExportStatus.READY, storage_key=storage_key):
            raise LogExportLeaseBusyError("The log export lease expired before publication.")


@contextmanager
def _renew_export_lease[FiltersT](
    task: LogExportTask[FiltersT], tasks: LogExportTaskStore[FiltersT]
) -> Generator[None]:
    """Retry temporary heartbeat failures and stop on lease loss, a permanent error, or worker exit."""
    stopped = Event()

    def renew() -> None:
        while not stopped.wait(_LOG_EXPORT_LEASE_RENEW_SECONDS):
            try:
                if not tasks.renew(task):
                    return
            except Exception as exc:
                logger.exception("Failed to renew log export lease: task=%s attempt=%s", task.task_id, task.attempt)
                if not isinstance(exc, LogExportLeaseBusyError):
                    return

    heartbeat = Thread(target=renew, name="log-export-lease", daemon=True)
    heartbeat.start()
    try:
        yield
    finally:
        stopped.set()
        heartbeat.join(timeout=5)


def _mark_failed[FiltersT](task: LogExportTask[FiltersT], tasks: LogExportTaskStore[FiltersT]) -> bool | None:
    """Record failure if owned, return False on loss, or log the write error and return None."""
    try:
        return tasks.finish(task, status=LogExportStatus.FAILED)
    except Exception:
        logger.exception(
            "Failed to record log export failure: tenant=%s app=%s task=%s", task.tenant_id, task.app_id, task.task_id
        )
        return None
