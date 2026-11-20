"""Read owned conversations and restore their inputs outside the query transaction."""

from collections.abc import Callable, Mapping
from dataclasses import replace
from typing import Protocol

from machinery.context import RequestContext
from services.entities.conversation_entities import (
    ConsoleChatConversationDetail,
    ConsoleCompletionConversationDetail,
    ConsoleCompletionConversationRecord,
    ConsoleConversationDetailSource,
    ConsoleConversationFilters,
    ConsoleConversationKind,
    ConsoleConversationLogFilters,
    ConsoleConversationPage,
    ConsoleConversationScope,
    ConsoleLogIdentity,
    ConversationInputValue,
    ConversationListSource,
    ConversationLogExportCounts,
    ConversationPage,
    ConversationScope,
    ConversationSort,
)
from services.message_query_service import MessageFiles


class ConversationQueryStore(Protocol):
    def get_console_detail(
        self, context: RequestContext, app_id: str, conversation_id: str, *, kind: ConsoleConversationKind
    ) -> ConsoleConversationDetailSource: ...

    def get_console_scope(
        self, context: RequestContext, app_id: str, *, kind: ConsoleConversationKind
    ) -> ConsoleConversationScope: ...

    def get_console_page(
        self, *, scope: ConsoleConversationScope, filters: ConsoleConversationFilters
    ) -> ConsoleConversationPage: ...

    def search_console_log_identities(
        self, context: RequestContext, app_id: str, *, keyword: str
    ) -> tuple[ConsoleLogIdentity, ...]:
        """Find bounded matches among identities appearing in the admitted app's visible Logs."""
        ...

    def get_console_log_export_counts(
        self, *, scope: ConsoleConversationScope, filters: ConsoleConversationLogFilters
    ) -> ConversationLogExportCounts | None:
        """Count visible conversations and their messages for the admitted Console log scope.

        Recheck application ownership and mode. Return None if the count query times out.
        """
        ...

    def get_page(
        self,
        *,
        scope: ConversationScope,
        invoke_from: ConversationListSource,
        last_id: str | None,
        limit: int,
        pinned: bool | None,
        sort_by: ConversationSort,
    ) -> ConversationPage: ...


class ConversationInputRestorer(Protocol):
    def __call__(
        self, *, inputs: Mapping[str, ConversationInputValue], tenant_resolver: Callable[[], str]
    ) -> dict[str, ConversationInputValue]: ...


class ConversationQueryService:
    def __init__(
        self, *, conversations: ConversationQueryStore, restore_inputs: ConversationInputRestorer, files: MessageFiles
    ) -> None:
        self._conversations = conversations
        self._restore_inputs = restore_inputs
        self._files = files

    def get_console_detail(
        self, context: RequestContext, app_id: str, conversation_id: str, *, kind: ConsoleConversationKind
    ) -> ConsoleCompletionConversationDetail | ConsoleChatConversationDetail:
        source = self._conversations.get_console_detail(context, app_id, conversation_id, kind=kind)
        record = source.record
        if isinstance(record, ConsoleCompletionConversationDetail) and record.first_message is not None:
            message = record.first_message
            files = self._files.resolve(
                tenant_id=source.tenant_id, inputs=message.inputs, answer=message.answer, files=source.files
            )
            record = replace(
                record,
                first_message=replace(message, inputs=files.inputs, answer=files.answer, message_files=files.files),
            )
        return record

    def get_console_scope(
        self, context: RequestContext, app_id: str, *, kind: ConsoleConversationKind
    ) -> ConsoleConversationScope:
        return self._conversations.get_console_scope(context, app_id, kind=kind)

    def get_console_page(
        self, *, scope: ConsoleConversationScope, filters: ConsoleConversationFilters
    ) -> ConsoleConversationPage:
        page = self._conversations.get_console_page(scope=scope, filters=filters)
        # Completion logs include the first message's file inputs. Restore them
        # only after every database-backed response field has been materialized.
        return replace(
            page,
            items=tuple(
                replace(
                    record,
                    first_message=replace(
                        record.first_message,
                        inputs=self._restore_inputs(
                            inputs=record.first_message.inputs, tenant_resolver=lambda: page.tenant_id
                        ),
                    ),
                )
                if isinstance(record, ConsoleCompletionConversationRecord) and record.first_message is not None
                else record
                for record in page.items
            ),
        )

    def search_console_log_identities(
        self, context: RequestContext, app_id: str, *, keyword: str
    ) -> tuple[ConsoleLogIdentity, ...]:
        """Search an admitted app's log identities with a validated nonblank keyword."""
        return self._conversations.search_console_log_identities(context, app_id, keyword=keyword)

    def get_console_log_export_counts(
        self, *, scope: ConsoleConversationScope, filters: ConsoleConversationLogFilters
    ) -> ConversationLogExportCounts | None:
        """Return unpaginated counts for admitted Console logs, or None on a query timeout."""
        return self._conversations.get_console_log_export_counts(scope=scope, filters=filters)

    def get_page(
        self,
        *,
        scope: ConversationScope,
        invoke_from: ConversationListSource,
        last_id: str | None,
        limit: int,
        pinned: bool | None,
        sort_by: ConversationSort,
    ) -> ConversationPage:
        page = self._conversations.get_page(
            scope=scope, invoke_from=invoke_from, last_id=last_id, limit=limit, pinned=pinned, sort_by=sort_by
        )
        # Legacy file reconstruction may query metadata. Keep that compatibility
        # outside the repository transaction.
        return replace(
            page,
            data=tuple(
                replace(
                    record,
                    inputs=self._restore_inputs(inputs=record.inputs, tenant_resolver=lambda: page.tenant_id),
                )
                for record in page.data
            ),
        )
