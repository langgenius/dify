"""Read owned conversations and restore their inputs outside the query transaction."""

from collections.abc import Callable, Mapping
from dataclasses import replace
from typing import Protocol

from machinery.context import RequestContext
from services.entities.conversation_entities import (
    ConsoleCompletionConversationRecord,
    ConsoleConversationFilters,
    ConsoleConversationKind,
    ConsoleConversationPage,
    ConsoleConversationScope,
    ConversationInputValue,
    ConversationListSource,
    ConversationPage,
    ConversationScope,
    ConversationSort,
)


class ConversationQueryStore(Protocol):
    def get_console_scope(
        self, context: RequestContext, app_id: str, *, kind: ConsoleConversationKind
    ) -> ConsoleConversationScope: ...

    def get_console_page(
        self, *, scope: ConsoleConversationScope, filters: ConsoleConversationFilters
    ) -> ConsoleConversationPage: ...

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
    def __init__(self, *, conversations: ConversationQueryStore, restore_inputs: ConversationInputRestorer) -> None:
        self._conversations = conversations
        self._restore_inputs = restore_inputs

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
        # outside the repository transaction and reuse the model's shared helper.
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
