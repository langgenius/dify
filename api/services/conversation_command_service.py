"""Mutate owned conversations and dispatch cleanup after persistence commits."""

from typing import Protocol

from services.entities.conversation_entities import ConversationDeletion, ConversationRef


class ConversationCommandStore(Protocol):
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
