"""Mutate owned conversations and dispatch cleanup after persistence commits."""

from typing import Protocol

from machinery.context import RequestContext
from services.entities.conversation_entities import (
    ConsoleConversationKind,
    ConversationAgentWorkspaceRetirement,
    ConversationDeletion,
    ConversationRef,
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

    def retire_console_debug_agent_workspaces(
        self, context: RequestContext, app_id: str
    ) -> ConversationAgentWorkspaceRetirement:
        """Commit retirement of the (app, account) pair's Chatflow debug Conversation workspaces.

        Enforced rules: ``app_id`` is an advanced-chat App of the admitted
        workspace, else ``ConsoleAppNotFoundError``. Every ACTIVE workspace and
        binding owned by the caller's non-deleted Console debugger Conversations
        of that App is retired; other accounts' debug sessions, the Conversations
        and their messages are untouched. When nothing is active it commits nothing and returns no ids.
        """
        ...

    def set_pinned(self, *, ref: ConversationRef, is_pinned: bool) -> None:
        """Set the caller's pin; removing an absent pin succeeds."""
        ...


class ConversationCleanup(Protocol):
    def __call__(self, *, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None: ...


class AgentWorkspaceCollection(Protocol):
    def __call__(self, *, tenant_id: str, agent_workspace_ids: tuple[str, ...]) -> None: ...


class ConversationCommandService:
    def __init__(
        self,
        *,
        conversations: ConversationCommandStore,
        enqueue_delete_cleanup: ConversationCleanup,
        collect_agent_workspaces: AgentWorkspaceCollection,
    ) -> None:
        self._conversations: ConversationCommandStore = conversations
        self._enqueue_delete_cleanup: ConversationCleanup = enqueue_delete_cleanup
        self._collect_agent_workspaces: AgentWorkspaceCollection = collect_agent_workspaces

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

    def retire_console_debug_agent_workspaces(self, context: RequestContext, app_id: str) -> None:
        """Retire the editor's ended Chatflow debug sessions' workspaces, then request collection.

        Preconditions: the store rules on ``retire_console_debug_agent_workspaces``.
        Postconditions: the retirement is committed before collection is
        requested, so a failed commit never destroys a live workspace; nothing
        is requested when no workspace was retired. Store errors propagate with
        no collection; a collection failure cannot undo the committed retirement.
        """
        retired = self._conversations.retire_console_debug_agent_workspaces(context, app_id)
        if retired.retired_agent_workspace_ids:
            self._collect_agent_workspaces(
                tenant_id=retired.tenant_id, agent_workspace_ids=retired.retired_agent_workspace_ids
            )

    def set_pinned(self, *, ref: ConversationRef, is_pinned: bool) -> None:
        self._conversations.set_pinned(ref=ref, is_pinned=is_pinned)
