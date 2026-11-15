"""Mutate owned conversations and dispatch cleanup after persistence commits."""

from typing import Protocol

from machinery.context import RequestContext
from services.entities.conversation_entities import ConsoleConversationKind, ConversationDeletion, ConversationRef


class ConversationCommandStore(Protocol):
    def mark_console_read(
        self, context: RequestContext, app_id: str, conversation_id: str, *, kind: ConsoleConversationKind
    ) -> None: ...

    def delete_console(
        self, context: RequestContext, app_id: str, conversation_id: str, *, kind: ConsoleConversationKind
    ) -> ConversationDeletion:
        """Delete the account's Console conversation within the admitted workspace."""
        ...

    def delete(self, *, ref: ConversationRef) -> ConversationDeletion:
        """Commit soft deletion and workspace retirement before returning cleanup data."""
        ...

    def set_pinned(self, *, ref: ConversationRef, is_pinned: bool) -> None:
        """Set the caller's pin; removing an absent pin succeeds."""
        ...


class ConversationCleanup(Protocol):
    def __call__(self, *, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None: ...


class ConversationCommandService:
    def __init__(self, *, conversations: ConversationCommandStore, enqueue_delete_cleanup: ConversationCleanup) -> None:
        self._conversations: ConversationCommandStore = conversations
        self._enqueue_delete_cleanup: ConversationCleanup = enqueue_delete_cleanup

    def mark_console_read(
        self, context: RequestContext, app_id: str, conversation_id: str, *, kind: ConsoleConversationKind
    ) -> None:
        """Record the legacy Console read receipt after detail rendering succeeds."""
        self._conversations.mark_console_read(context, app_id, conversation_id, kind=kind)

    def delete_console(
        self, context: RequestContext, app_id: str, conversation_id: str, *, kind: ConsoleConversationKind
    ) -> None:
        deleted = self._conversations.delete_console(context, app_id, conversation_id, kind=kind)
        self._enqueue_delete_cleanup(
            tenant_id=deleted.tenant_id,
            conversation_id=deleted.conversation_id,
            retired_workspace_ids=deleted.retired_workspace_ids,
        )

    def delete(self, *, ref: ConversationRef) -> None:
        deleted = self._conversations.delete(ref=ref)
        # The retirement and soft-delete commit must precede physical cleanup.
        self._enqueue_delete_cleanup(
            tenant_id=deleted.tenant_id,
            conversation_id=deleted.conversation_id,
            retired_workspace_ids=deleted.retired_workspace_ids,
        )

    def set_pinned(self, *, ref: ConversationRef, is_pinned: bool) -> None:
        self._conversations.set_pinned(ref=ref, is_pinned=is_pinned)
