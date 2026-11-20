"""Create export tasks and write CSV for the logs of one Console chat app."""

import csv
import logging
from collections.abc import Callable, Generator, Iterable
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Protocol, TextIO
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from core.helper.csv_sanitizer import CSVSanitizer
from libs.datetime_utils import ensure_naive_utc, utc_now
from machinery.context import RequestContext
from services.entities.conversation_entities import (
    ConsoleConversationKind,
    ConsoleConversationLogFilters,
    ConsoleConversationScope,
    ConversationLogExportRow,
)

logger = logging.getLogger(__name__)

type StoreLogExportFile = Callable[[str, Callable[[TextIO], int]], None]
type LogExportDownload = str | tuple[bytes, Generator[bytes]]

_LOG_EXPORT_TASK_TTL = timedelta(days=1)
_LOG_EXPORT_DOWNLOAD_URL_TTL_SECONDS = 3600
_LOG_CSV_APP_TYPES = {"chat": "Chatbot", "advanced-chat": "Chatflow", "agent-chat": "Agent"}
_LOG_CSV_COLUMNS = (
    "app_id",
    "app_type",
    "end_user_id",
    "account_id",
    "account_name",
    "conversation_id",
    "run_id",
    "message_id",
    "created_at",
    "user_input",
    "app_response",
    "feedback_rating",
    "feedback_content",
    "status",
    "trigger_by",
    "source",
    "agent_id",
)


class ConversationLogExportStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class ConversationLogExportTask(BaseModel):
    """Persist the admitted owner, normalized filters and state of a temporary export."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    task_id: str
    tenant_id: str
    app_id: str
    requested_by: str
    filters: ConsoleConversationLogFilters
    created_at: datetime
    expires_at: datetime
    status: ConversationLogExportStatus = ConversationLogExportStatus.PENDING
    storage_key: str | None = None


class UnsupportedConversationLogExportModeError(ValueError):
    """The admitted app has no conversation log CSV export."""


class ConversationLogExportTaskNotFoundError(Exception):
    """The task is unavailable for the admitted app."""


class ConversationLogExportTaskNotReadyError(Exception):
    """The admitted export task has no completed CSV."""


class ConversationLogExportFileNotFoundError(Exception):
    """The completed export's CSV could not be opened."""


class ConversationLogExportTaskStore(Protocol):
    def save(self, task: ConversationLogExportTask) -> None:
        """Persist a new task and remember it as its requester's latest for the app."""
        ...

    def get(self, *, tenant_id: str, app_id: str, task_id: str) -> ConversationLogExportTask | None:
        """Return a live task for the exact workspace and app, or None if absent or expired."""
        ...

    def get_latest(self, *, tenant_id: str, app_id: str, requested_by: str) -> ConversationLogExportTask | None:
        """Return the requester's latest live task for this app, or None if unavailable."""
        ...

    def transition(self, task: ConversationLogExportTask, *, from_status: ConversationLogExportStatus) -> bool:
        """Replace a live task only from the expected status, keeping its original expiration."""
        ...


class ConversationLogExportStore(Protocol):
    def get_console_scope(
        self, context: RequestContext, app_id: str, *, kind: ConsoleConversationKind
    ) -> ConsoleConversationScope:
        """Return the owned chat app scope for an admitted Console caller."""
        ...

    def iter_console_log_export_rows(
        self, *, scope: ConsoleConversationScope, filters: ConsoleConversationLogFilters
    ) -> Iterable[ConversationLogExportRow]:
        """Read all messages in matching conversations and release the session between batches."""
        ...


class ConversationLogExportService:
    """Create temporary export tasks and generate their CSV from detached log records."""

    def __init__(
        self,
        *,
        conversations: ConversationLogExportStore,
        tasks: ConversationLogExportTaskStore,
        dispatch: Callable[[ConversationLogExportTask], None],
        store_csv: StoreLogExportFile,
        open_csv: Callable[[str, int, str], LogExportDownload],
    ) -> None:
        """Bind scoped log reads, export task state, delivery and file storage."""
        self._conversations = conversations
        self._tasks = tasks
        self._dispatch = dispatch
        self._store_csv = store_csv
        self._open_csv = open_csv

    def create_task(
        self, *, scope: ConsoleConversationScope, requested_by: str, filters: ConsoleConversationLogFilters
    ) -> ConversationLogExportTask:
        """Save and dispatch a pending task for an admitted app and caller before returning its ID.

        Require time filters converted from the caller's timezone to UTC. Propagate a
        publication failure and mark the task failed if it is still pending.
        """
        if scope.app_mode not in _LOG_CSV_APP_TYPES:
            raise UnsupportedConversationLogExportModeError("App mode does not support conversation log CSV exports.")
        created_at = utc_now()
        task = ConversationLogExportTask(
            task_id=str(uuid4()),
            tenant_id=scope.tenant_id,
            app_id=scope.app_id,
            requested_by=requested_by,
            filters=filters,
            created_at=created_at,
            expires_at=created_at + _LOG_EXPORT_TASK_TTL,
        )
        try:
            self._tasks.save(task)
            self._dispatch(task)
        except Exception:
            self._mark_failed(task)
            raise
        return task

    def get_task(self, *, scope: ConsoleConversationScope, task_id: str) -> ConversationLogExportTask:
        """Return the live task for the admitted workspace and app, or raise if it is unavailable."""
        task = self._tasks.get(tenant_id=scope.tenant_id, app_id=scope.app_id, task_id=task_id)
        if task is None:
            raise ConversationLogExportTaskNotFoundError()
        return task

    def get_latest_task(
        self, *, scope: ConsoleConversationScope, requested_by: str
    ) -> ConversationLogExportTask | None:
        """Return the admitted caller's latest live task for the app, if one exists."""
        return self._tasks.get_latest(tenant_id=scope.tenant_id, app_id=scope.app_id, requested_by=requested_by)

    def download_csv(self, *, scope: ConsoleConversationScope, task_id: str, filename: str) -> LogExportDownload:
        """Serve a live, ready export as a short-lived storage URL or an opened CSV stream."""
        task = self.get_task(scope=scope, task_id=task_id)
        if task.status is not ConversationLogExportStatus.READY or not task.storage_key:
            raise ConversationLogExportTaskNotReadyError()
        remaining_seconds = int((task.expires_at - utc_now()).total_seconds())
        if remaining_seconds < 1:
            raise ConversationLogExportTaskNotFoundError()
        expires_in = min(_LOG_EXPORT_DOWNLOAD_URL_TTL_SECONDS, remaining_seconds)
        return self._open_csv(task.storage_key, expires_in, filename)

    def prepare_task(self, *, tenant_id: str, app_id: str, task_id: str) -> None:
        """Claim a live pending task and store its CSV before setting ready.

        Resolve the app against the saved workspace and account. Only the worker that
        claims the pending state may write the artifact. Record ordinary failures before
        propagating them, and leave missing or previously claimed tasks alone.
        """
        task = self._tasks.get(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
        if task is None or task.status is not ConversationLogExportStatus.PENDING:
            return
        processing = task.model_copy(update={"status": ConversationLogExportStatus.PROCESSING})
        if not self._tasks.transition(processing, from_status=ConversationLogExportStatus.PENDING):
            return

        context = RequestContext(
            request_id=task.task_id, trace_id=None, account_id=task.requested_by, active_workspace_id=task.tenant_id
        )
        storage_key = f"conversation-log-exports/{task.tenant_id}/{task.app_id}/{task.task_id}.csv"
        try:
            self._store_csv(
                storage_key, lambda output: self.write_csv(context, task.app_id, filters=task.filters, output=output)
            )
            ready = processing.model_copy(
                update={"status": ConversationLogExportStatus.READY, "storage_key": storage_key}
            )
            self._tasks.transition(ready, from_status=ConversationLogExportStatus.PROCESSING)
        except Exception:
            self._mark_failed(processing)
            raise

    def _mark_failed(self, task: ConversationLogExportTask) -> None:
        """Record failure from the last owned state while preserving the original exception."""
        try:
            self._tasks.transition(
                task.model_copy(update={"status": ConversationLogExportStatus.FAILED}),
                from_status=task.status,
            )
        except Exception:
            logger.exception(
                "Failed to record conversation log export failure: tenant=%s app=%s task=%s",
                task.tenant_id,
                task.app_id,
                task.task_id,
            )

    def write_csv(
        self,
        context: RequestContext,
        app_id: str,
        *,
        filters: ConsoleConversationLogFilters,
        output: TextIO,
    ) -> int:
        """Write the app's filtered chat logs to a UTF-8 text stream and return its data row count.

        Require an admitted caller and a writable stream opened with newline="". The caller
        owns the stream and publishes it only after success, since a failure may leave partial output.
        """
        scope = self._conversations.get_console_scope(context, app_id, kind="chat")
        app_type = _LOG_CSV_APP_TYPES.get(scope.app_mode)
        if app_type is None:
            raise UnsupportedConversationLogExportModeError("App mode does not support conversation log CSV exports.")

        output.write("\ufeff")
        writer = csv.writer(output, quoting=csv.QUOTE_ALL)
        writer.writerow(_LOG_CSV_COLUMNS)
        row_count = 0
        for row in self._conversations.iter_console_log_export_rows(scope=scope, filters=filters):
            values = (
                scope.app_id,
                app_type,
                row.end_user_id,
                row.account_id,
                row.account_name,
                row.conversation_id,
                "",
                row.message_id,
                ensure_naive_utc(row.created_at).replace(tzinfo=UTC).isoformat(),
                row.user_input,
                row.app_response,
                row.feedback_rating,
                row.feedback_content,
                row.status,
                "",
                "",
                "",
            )
            writer.writerow(CSVSanitizer.sanitize_value(value) for value in values)
            row_count += 1
        return row_count
