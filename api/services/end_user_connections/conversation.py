"""Restore a Conversation's last accepted choices before fixing a new Run snapshot."""

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from context.connection_execution import ConnectionExecutionContext
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionWorkflowChangedError


@dataclass(frozen=True)
class SavedConversationConnection:
    workflow_id: str
    node_id: str
    provider: str
    connection_id: str


class ConversationConnections(Protocol):
    def save_run_conversation_selections(self, execution: ConnectionExecutionContext, conversation_id: str) -> None: ...

    def conversation_selections(
        self, context: WebConnectionContext, workflow_id: str, conversation_id: str
    ) -> tuple[SavedConversationConnection, ...]: ...


class ConversationConnectionService:
    def __init__(self, *, store: ConversationConnections) -> None:
        self._store = store

    def restore(self, context: WebConnectionContext, workflow_id: str, conversation_id: str) -> dict[str, UUID]:
        saved = self._store.conversation_selections(context, workflow_id, conversation_id)
        if any(item.workflow_id != workflow_id for item in saved):
            raise ConnectionWorkflowChangedError()
        return {item.node_id: UUID(item.connection_id) for item in saved}

    def save_run(self, execution: ConnectionExecutionContext, conversation_id: str) -> None:
        self._store.save_run_conversation_selections(execution, conversation_id)
