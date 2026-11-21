"""Create export tasks and write CSV for the logs of one Console conversation app."""

import json
from collections.abc import Callable, Iterable
from datetime import UTC
from typing import Protocol, TextIO

from libs.datetime_utils import ensure_naive_utc
from machinery.context import RequestContext
from services.entities.conversation_entities import (
    ConsoleConversationLogFilters,
    ConsoleConversationScope,
    ConversationLogExportRow,
)
from services.retention.log_export_csv import write_log_export_csv
from services.retention.log_export_task import (
    LogExportDownload,
    LogExportStatus,
    LogExportTask,
    LogExportTaskNotFoundError,
    LogExportTaskStore,
    OpenLogExportFile,
    StoreLogExportFile,
    open_ready_log_export_csv,
    prepare_log_export_task,
    save_and_dispatch_log_export_task,
)

_LOG_CSV_IDENTITY_COLUMNS = ("app_id", "app_type", "end_user_id", "account_id", "account_name")
_LOG_CSV_MESSAGE_COLUMNS = (
    "message_id",
    "created_at",
    "user_input",
    "app_response",
    "feedback_rating",
    "feedback_content",
)
_CHAT_LOG_CSV_COLUMNS = (*_LOG_CSV_IDENTITY_COLUMNS, "conversation_id", *_LOG_CSV_MESSAGE_COLUMNS)
_LOG_CSV_LAYOUTS = {
    "chat": ("Chatbot", _CHAT_LOG_CSV_COLUMNS),
    "advanced-chat": ("Chatflow", (*_CHAT_LOG_CSV_COLUMNS, "status")),
    "agent-chat": ("Agent", _CHAT_LOG_CSV_COLUMNS),
    "completion": ("Text Generator", (*_LOG_CSV_IDENTITY_COLUMNS, *_LOG_CSV_MESSAGE_COLUMNS)),
}


ConversationLogExportStatus = LogExportStatus
ConversationLogExportTask = LogExportTask[ConsoleConversationLogFilters]


class UnsupportedConversationLogExportModeError(ValueError):
    """The admitted app has no conversation log CSV export."""


class ConversationLogExportStore(Protocol):
    def get_console_log_export_scope(self, context: RequestContext, app_id: str) -> ConsoleConversationScope:
        """Return the owned conversation app scope for an admitted Console caller."""
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
        tasks: LogExportTaskStore[ConsoleConversationLogFilters],
        dispatch: Callable[[ConversationLogExportTask], None],
        store_csv: StoreLogExportFile,
        open_csv: OpenLogExportFile,
    ) -> None:
        """Bind scoped log reads, export task state, delivery and file storage."""
        self._conversations = conversations
        self._tasks = tasks
        self._dispatch = dispatch
        self._store_csv = store_csv
        self._open_csv = open_csv

    def get_scope(self, context: RequestContext, app_id: str) -> ConsoleConversationScope:
        """Resolve the app's conversation logs for an admitted caller."""
        return self._conversations.get_console_log_export_scope(context, app_id)

    def create_task(
        self, *, scope: ConsoleConversationScope, requested_by: str, filters: ConsoleConversationLogFilters
    ) -> ConversationLogExportTask:
        """Save and dispatch a pending task for an admitted app and caller before returning its ID.

        Require time filters converted from the caller's timezone to UTC. Propagate a
        publication failure and mark the task failed if it is still pending.
        """
        if scope.app_mode not in _LOG_CSV_LAYOUTS:
            raise UnsupportedConversationLogExportModeError("App mode does not support conversation log CSV exports.")
        task = ConversationLogExportTask.pending(
            tenant_id=scope.tenant_id,
            app_id=scope.app_id,
            requested_by=requested_by,
            filters=filters,
        )
        save_and_dispatch_log_export_task(task, tasks=self._tasks, dispatch=self._dispatch)
        return task

    def get_task(self, *, scope: ConsoleConversationScope, task_id: str) -> ConversationLogExportTask:
        """Return the live task for the admitted workspace and app, or raise if it is unavailable."""
        task = self._tasks.get(tenant_id=scope.tenant_id, app_id=scope.app_id, task_id=task_id)
        if task is None:
            raise LogExportTaskNotFoundError()
        return task

    def get_latest_task(
        self, *, scope: ConsoleConversationScope, requested_by: str
    ) -> ConversationLogExportTask | None:
        """Return the admitted caller's latest live task for the app, if one exists."""
        return self._tasks.get_latest(tenant_id=scope.tenant_id, app_id=scope.app_id, requested_by=requested_by)

    def download_csv(self, *, scope: ConsoleConversationScope, task_id: str, filename: str) -> LogExportDownload:
        """Serve a live, ready export as a short-lived storage URL or an opened CSV stream."""
        task = self.get_task(scope=scope, task_id=task_id)
        return open_ready_log_export_csv(task, open_csv=self._open_csv, filename=filename)

    def prepare_task(self, *, tenant_id: str, app_id: str, task_id: str) -> None:
        """Load the task for the workspace and app and prepare its CSV if it is still pending."""
        task = self._tasks.get(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
        prepare_log_export_task(
            task,
            tasks=self._tasks,
            storage_prefix="conversation-log-exports",
            store_csv=self._store_csv,
            write_csv=self.write_csv,
        )

    def write_csv(
        self,
        context: RequestContext,
        app_id: str,
        *,
        filters: ConsoleConversationLogFilters,
        output: TextIO,
    ) -> int:
        """Write the app's filtered logs with its mode's columns and return the data row count.

        Require an admitted caller and a writable stream opened with newline="". The caller
        owns the stream and publishes it only after success, since a failure may leave partial output.
        """
        scope = self.get_scope(context, app_id)
        layout = _LOG_CSV_LAYOUTS.get(scope.app_mode)
        if layout is None:
            raise UnsupportedConversationLogExportModeError("App mode does not support conversation log CSV exports.")
        app_type, columns = layout

        rows = self._conversations.iter_console_log_export_rows(scope=scope, filters=filters)
        return write_log_export_csv(
            output,
            (
                {
                    "app_id": scope.app_id,
                    "app_type": app_type,
                    "end_user_id": row.end_user_id,
                    "account_id": row.account_id,
                    "account_name": row.account_name,
                    "conversation_id": row.conversation_id,
                    "message_id": row.message_id,
                    "created_at": ensure_naive_utc(row.created_at).replace(tzinfo=UTC).isoformat(),
                    "user_input": json.dumps(row.input_variables, ensure_ascii=False)
                    if row.input_variables
                    else row.user_input,
                    "app_response": row.app_response,
                    "feedback_rating": row.feedback_rating,
                    "feedback_content": row.feedback_content,
                    "status": row.status,
                }
                for row in rows
            ),
            columns=columns,
        )
