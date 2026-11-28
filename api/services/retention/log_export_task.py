"""Temporary CSV export tasks and their lifecycle, shared by Console applications."""

import logging
from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import datetime
from enum import StrEnum
from threading import Event, Thread
from typing import Protocol, Self, TextIO
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

from libs.datetime_utils import utc_now
from machinery.context import RequestContext
from services.entities.conversation_entities import ConsoleLogIdentitySource
from services.retention.log_export_csv import CsvRowProgress

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
    CANCELED = "canceled"


class LogExportStage(StrEnum):
    PREPARING = "preparing"
    WRITING = "writing"
    UPLOADING = "uploading"


class LogExportProgress(BaseModel):
    """The last reported stage and number of CSV data rows for the current attempt."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    stage: LogExportStage
    rows_written: int = Field(ge=0)


class LogExportTaskNotFoundError(Exception):
    """The task is unavailable for the admitted app."""


class LogExportTaskNotReadyError(Exception):
    """The admitted task has no completed CSV."""


class LogExportTaskNotCancelableError(Exception):
    """The task has already started or reached a terminal state."""


class LogExportFileNotFoundError(Exception):
    """The completed export's CSV could not be opened."""


class LogExportLimitReachedError(Exception):
    """The requester already has an active export in this app."""


class LogExportLeaseBusyError(Exception):
    """The worker should retry because task state or lease ownership cannot be confirmed."""


class LogExportIdentityLabel(BaseModel):
    """A display label captured by the requester for an identity in the export filters."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: UUID
    source: ConsoleLogIdentitySource
    label: str = Field(max_length=255)


def filter_log_export_identity_labels(
    labels: tuple[LogExportIdentityLabel, ...], *, end_user_ids: tuple[str, ...], account_ids: tuple[str, ...]
) -> tuple[LogExportIdentityLabel, ...]:
    """Keep at most one display label per selected source and ID, using the normalized filters as scope."""
    selected = {
        ConsoleLogIdentitySource.END_USER: set(end_user_ids),
        ConsoleLogIdentitySource.ACCOUNT: set(account_ids),
    }
    return tuple({(item.source, item.id): item for item in labels if str(item.id) in selected[item.source]}.values())


class LogExportTask[FiltersT](BaseModel):
    """Persist an admitted export's state and carry its lease token only in the owning worker."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    task_id: str
    tenant_id: str
    app_id: str
    requested_by: str
    filters: FiltersT
    created_at: datetime
    expires_at: datetime | None  # Active exports stay live until they reach a terminal state.
    identity_labels: tuple[LogExportIdentityLabel, ...] = ()
    estimated_rows: int | None = Field(default=None, ge=0, exclude_if=lambda value: value is None)
    status: LogExportStatus = LogExportStatus.PENDING
    storage_key: str | None = None
    progress: LogExportProgress | None = Field(default=None, exclude_if=lambda value: value is None)
    attempt: int = 0
    claim_token: str | None = Field(default=None, exclude=True, repr=False)

    @classmethod
    def pending(
        cls,
        *,
        tenant_id: str,
        app_id: str,
        requested_by: str,
        filters: FiltersT,
        identity_labels: tuple[LogExportIdentityLabel, ...] = (),
        estimated_rows: int | None = None,
    ) -> Self:
        """Build a pending task that remains available until execution or cancellation."""
        return cls(
            task_id=str(uuid4()),
            tenant_id=tenant_id,
            app_id=app_id,
            requested_by=requested_by,
            filters=filters,
            identity_labels=identity_labels,
            estimated_rows=estimated_rows,
            created_at=utc_now(),
            expires_at=None,
        )


def open_ready_log_export_csv[FiltersT](
    task: LogExportTask[FiltersT], *, open_csv: OpenLogExportFile, filename: str
) -> LogExportDownload:
    """Open an admitted, unexpired export after verifying its completed file and bounding the URL lifetime."""
    if task.status is not LogExportStatus.READY or not task.storage_key or task.expires_at is None:
        raise LogExportTaskNotReadyError()
    remaining_seconds = int((task.expires_at - utc_now()).total_seconds())
    if remaining_seconds < 1:
        raise LogExportTaskNotFoundError()
    expires_in = min(_LOG_EXPORT_DOWNLOAD_URL_TTL_SECONDS, remaining_seconds)
    return open_csv(task.storage_key, expires_in, filename)


class LogExportTaskStore[FiltersT](Protocol):
    def save(self, task: LogExportTask[FiltersT]) -> bool:
        """Atomically admit a pending task once and return whether it is at the workspace queue head."""
        ...

    def cancel(self, task: LogExportTask[FiltersT]) -> LogExportTask[FiltersT]:
        """Cancel and remove a pending task atomically, rejecting a concurrent worker claim."""
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

    def renew(self, task: LogExportTask[FiltersT], *, progress: LogExportProgress | None = None) -> bool:
        """Extend an owned lease and optionally advance progress.

        Return False on lease loss or raise LogExportLeaseBusyError if Redis cannot confirm ownership.
        """
        ...

    def finish(
        self, task: LogExportTask[FiltersT], *, status: LogExportStatus, storage_key: str | None = None
    ) -> LogExportTask[FiltersT] | None:
        """Publish and release capacity if owned, extending the lifetime of a ready task.

        Return the published task, return None on lease loss, or raise on a write error.
        """
        ...


class WriteLogExportCsv[FiltersT](Protocol):
    def __call__(
        self, context: RequestContext, app_id: str, /, *, filters: FiltersT, output: TextIO, report_rows: CsvRowProgress
    ) -> int:
        """Write matching log rows in this workspace, reporting the cumulative data row count."""
        ...


def save_and_dispatch_log_export_task[FiltersT](
    task: LogExportTask[FiltersT],
    *,
    tasks: LogExportTaskStore[FiltersT],
    dispatch: Callable[[str], None],
) -> None:
    """Save the delivery intent; wake the worker immediately when this task is first in line."""
    if tasks.save(task):
        dispatch(task.tenant_id)


def cancel_pending_log_export_task[FiltersT](
    task: LogExportTask[FiltersT],
    *,
    requested_by: str,
    tasks: LogExportTaskStore[FiltersT],
    dispatch: Callable[[str], None],
) -> LogExportTask[FiltersT]:
    """Cancel the requester's pending export and wake the next eligible workspace job."""
    if task.requested_by != requested_by:
        raise LogExportTaskNotFoundError()
    if task.status not in (LogExportStatus.PENDING, LogExportStatus.CANCELED):
        raise LogExportTaskNotCancelableError()
    canceled = tasks.cancel(task) if task.status is LogExportStatus.PENDING else task
    dispatch(task.tenant_id)
    return canceled


def prepare_log_export_task[FiltersT](
    task: LogExportTask[FiltersT] | None,
    *,
    tasks: LogExportTaskStore[FiltersT],
    storage_prefix: str,
    store_csv: StoreLogExportFile,
    write_csv: WriteLogExportCsv[FiltersT],
) -> LogExportTask[FiltersT] | None:
    """Return the ready task only after this attempt publishes its CSV while owning the lease."""
    if task is None or task.status not in (LogExportStatus.PENDING, LogExportStatus.PROCESSING):
        return None
    processing = tasks.claim(task)
    if processing is None:
        return None

    context = RequestContext(
        request_id=task.task_id, trace_id=None, account_id=task.requested_by, active_workspace_id=task.tenant_id
    )
    # A stale attempt can only upload to its own key.
    storage_key = f"{storage_prefix}/{task.tenant_id}/{task.app_id}/{task.task_id}/{processing.attempt}.csv"
    rows_written = 0

    def report_rows(count: int) -> None:
        """Keep the writer's cumulative count for the heartbeat to publish."""
        nonlocal rows_written
        rows_written = count

    def write_owned_csv(output: TextIO) -> int:
        """Generate the CSV and publish its exact row count before starting the upload."""
        count = write_csv(context, task.app_id, filters=task.filters, output=output, report_rows=report_rows)
        if not tasks.renew(processing, progress=LogExportProgress(stage=LogExportStage.UPLOADING, rows_written=count)):
            raise LogExportLeaseBusyError("The log export lease expired before upload.")
        return count

    with _renew_export_lease(processing, tasks, read_rows=lambda: rows_written):
        try:
            count = store_csv(storage_key, write_owned_csv)
        except LogExportLeaseBusyError:
            raise
        except Exception as exc:
            try:
                failure_recorded = tasks.finish(processing, status=LogExportStatus.FAILED)
            except LogExportLeaseBusyError:
                raise
            except Exception:
                logger.exception(
                    "Failed to record log export failure: tenant=%s app=%s task=%s",
                    task.tenant_id,
                    task.app_id,
                    task.task_id,
                )
            else:
                if failure_recorded is None:
                    raise LogExportLeaseBusyError("The log export attempt no longer owns its lease.") from exc
            raise
        completed = processing.model_copy(
            update={"progress": LogExportProgress(stage=LogExportStage.UPLOADING, rows_written=count)}
        )
        ready = tasks.finish(completed, status=LogExportStatus.READY, storage_key=storage_key)
        if ready is None:
            raise LogExportLeaseBusyError("The log export lease expired before publication.")
        return ready


@contextmanager
def _renew_export_lease[FiltersT](
    task: LogExportTask[FiltersT], tasks: LogExportTaskStore[FiltersT], *, read_rows: Callable[[], int]
) -> Generator[None]:
    """Renew the lease and publish written rows until lease loss, a permanent error, or worker exit."""
    stopped = Event()

    def renew() -> None:
        while not stopped.wait(_LOG_EXPORT_LEASE_RENEW_SECONDS):
            try:
                count = read_rows()
                progress = LogExportProgress(stage=LogExportStage.WRITING, rows_written=count) if count else None
                if not tasks.renew(task, progress=progress):
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
