"""Generate CSV files for the logs of one Console chat app."""

import csv
from collections.abc import Iterable
from datetime import UTC
from typing import Protocol, TextIO

from core.helper.csv_sanitizer import CSVSanitizer
from libs.datetime_utils import ensure_naive_utc
from machinery.context import RequestContext
from services.entities.conversation_entities import (
    ConsoleConversationKind,
    ConsoleConversationLogFilters,
    ConsoleConversationScope,
    ConversationLogExportRow,
)

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
    """Write detached log records to a caller-owned CSV stream."""

    def __init__(self, *, conversations: ConversationLogExportStore) -> None:
        """Bind the store that resolves app ownership and reads the logs."""
        self._conversations = conversations

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
            raise ValueError("App mode does not support conversation log CSV exports.")

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
