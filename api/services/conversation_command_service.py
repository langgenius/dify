"""Mutate owned conversations and dispatch cleanup after persistence commits."""

from typing import Protocol

from machinery.context import RequestContext
from services.entities.conversation_entities import (
    ConsoleConversationKind,
    ConversationDeletion,
    ConversationRef,
    ConversationWorkspaceRetirement,
)


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

    def retire_console_debug_workspaces(
        self, context: RequestContext, app_id: str, conversation_id: str
    ) -> ConversationWorkspaceRetirement:
        """Commit retirement of the account's Chatflow debug Conversation workspaces.

        Enforced rules: ``app_id`` is an advanced-chat App of the admitted
        workspace, else ``ConsoleAppNotFoundError``; ``conversation_id`` is the
        caller's non-deleted Console debugger Conversation of that App, else
        ``ConversationNotExistsError``. Only ACTIVE workspaces and bindings are
        retired; the Conversation and its messages are untouched. Retiring an
        already-retired Conversation commits nothing and returns no ids.
        """
        ...

    def set_pinned(self, *, ref: ConversationRef, is_pinned: bool) -> None:
        """Set the caller's pin; removing an absent pin succeeds."""
        ...


class ConversationCleanup(Protocol):
    def __call__(self, *, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None: ...


class WorkspaceCollection(Protocol):
    def __call__(self, *, tenant_id: str, workspace_ids: tuple[str, ...]) -> None: ...


class ConversationCommandService:
    def __init__(
        self,
        *,
        conversations: ConversationCommandStore,
        enqueue_delete_cleanup: ConversationCleanup,
        collect_workspaces: WorkspaceCollection,
    ) -> None:
        self._conversations: ConversationCommandStore = conversations
        self._enqueue_delete_cleanup: ConversationCleanup = enqueue_delete_cleanup
        self._collect_workspaces: WorkspaceCollection = collect_workspaces

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

    def retire_console_debug_workspaces(self, context: RequestContext, app_id: str, conversation_id: str) -> None:
        """Retire a closed Chatflow debug session's workspaces, then request collection.

        Preconditions: the store rules on ``retire_console_debug_workspaces``.
        Postconditions: the retirement is committed before collection is
        requested, so a failed commit never destroys a live workspace; nothing
        is requested when no workspace was retired. Store errors propagate with
        no collection; a collection failure cannot undo the committed retirement.
        """
        retired = self._conversations.retire_console_debug_workspaces(context, app_id, conversation_id)
        if retired.retired_workspace_ids:
            self._collect_workspaces(tenant_id=retired.tenant_id, workspace_ids=retired.retired_workspace_ids)

    def set_pinned(self, *, ref: ConversationRef, is_pinned: bool) -> None:
        self._conversations.set_pinned(ref=ref, is_pinned=is_pinned)
