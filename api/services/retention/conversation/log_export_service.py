"""Create export tasks and write CSV for the logs of one Console chat app."""

import csv
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol, TextIO
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

_LOG_EXPORT_TASK_TTL = timedelta(days=1)
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


class ConversationLogExportTask(BaseModel):
    """Persist the admitted owner and normalized filters for a pending export."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    task_id: str
    tenant_id: str
    app_id: str
    requested_by: str
    filters: ConsoleConversationLogFilters
    created_at: datetime
    expires_at: datetime
    status: Literal["pending"] = "pending"


class UnsupportedConversationLogExportModeError(ValueError):
    """The admitted app has no conversation log CSV export."""


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
        self, *, conversations: ConversationLogExportStore, save_task: Callable[[ConversationLogExportTask], None]
    ) -> None:
        """Bind owned conversation reads and a write that persists a task with its expiration."""
        self._conversations = conversations
        self._save_task = save_task

    def create_task(
        self, *, scope: ConsoleConversationScope, requested_by: str, filters: ConsoleConversationLogFilters
    ) -> ConversationLogExportTask:
        """Save a new pending task for an admitted app and caller before returning its ID.

        Require time filters converted from the caller's timezone to UTC. An unsupported
        mode or a failed store write raises before a task can be acknowledged.
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
        self._save_task(task)
        return task

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
