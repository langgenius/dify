"""Owner-scoped transcript selection; branching never rewinds workflow state."""

from collections.abc import Mapping
from typing import Any, Protocol

from machinery.context import ServiceApiEndUserContext
from machinery.message_history import MessageHistory


class MessageBranchStore(Protocol):
    def admit_message_history(
        self,
        *,
        context: ServiceApiEndUserContext,
        conversation_id: str,
        parent_message_id: str | None,
    ) -> MessageHistory:
        """Verify owners and atomically admit at most 500 ancestors, oldest first.

        None selects an empty root. Each ancestor, including a legacy linear
        predecessor, must belong to the admitted owner chain. Missing/cyclic
        references fail without writes. Unambiguous nil edges are materialized
        under owner/row locks in one short transaction; text remains unchanged.
        """
        ...

    def validate_message_history(self, *, context: ServiceApiEndUserContext, history: MessageHistory) -> MessageHistory:
        """Batch-verify frozen ownership and explicit links without any writes."""
        ...


class MessageBranchService:
    def __init__(self, *, messages: MessageBranchStore) -> None:
        """Receive the scoped history port without performing I/O."""
        self._messages = messages

    @staticmethod
    def validate_workflow(graph: Mapping[str, Any]) -> None:
        """Reject persistent Agent workspaces before generation can execute effects.

        Ordinary LLM and plugin Agent nodes consume the selected transcript.
        The new Agent backend has a separate conversation workspace; until it
        supports branching, accepting it would expose another branch's memory.
        """
        for node in graph.get("nodes", ()):
            data = node.get("data", {})
            if data.get("type") == "agent" and data.get("agent_node_kind") == "dify_agent":
                raise ValueError("Explicit message branches do not yet support Dify Agent workspace nodes.")

    def resolve(
        self,
        *,
        context: ServiceApiEndUserContext,
        conversation_id: str | None,
        parent_message_id: str | None,
    ) -> MessageHistory:
        """Resolve a parent in an existing Advanced Chat conversation.

        Context comes from admission, never request metadata. Unsupported input
        fails before I/O. Success can normalize legacy parent links, but leaves
        message text, IDs, descendants, workflow state and effects intact.
        """
        self.validate_request(context=context, conversation_id=conversation_id, parent_message_id=parent_message_id)
        assert conversation_id is not None
        return self._messages.admit_message_history(
            context=context, conversation_id=conversation_id, parent_message_id=parent_message_id
        )

    @staticmethod
    def validate_request(
        *, context: ServiceApiEndUserContext, conversation_id: str | None, parent_message_id: str | None
    ) -> None:
        """Validate request shape without I/O; persisted ownership is checked at admission."""
        if context.app_mode != "advanced-chat":
            raise ValueError("Explicit message branches are supported only for Advanced Chat apps.")
        if not conversation_id:
            raise ValueError("conversation_id is required when parent_message_id is provided.")
        if parent_message_id == "00000000-0000-0000-0000-000000000000":
            raise ValueError("Select a message ID or null, not the reserved nil parent UUID.")

    def revalidate(
        self,
        *,
        context: ServiceApiEndUserContext,
        conversation_id: str | None,
        parent_message_id: str | None,
        history: MessageHistory,
    ) -> MessageHistory:
        """Restore trusted history after serialization, without re-admitting legacy edges.

        Context must be admitted independently of the payload. Parent, scope and
        full rooted chain must match persisted records; failures do not fall back.
        """
        self.validate_request(context=context, conversation_id=conversation_id, parent_message_id=parent_message_id)
        if (
            history.app_id != context.app_id
            or history.conversation_id != conversation_id
            or len(set(history.message_ids)) != len(history.message_ids)
            or (history.message_ids[-1] if history.message_ids else None) != parent_message_id
        ):
            raise ValueError("Frozen history does not match the selected message branch.")
        return self._messages.validate_message_history(context=context, history=history)
