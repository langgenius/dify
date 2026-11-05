"""Owner-scoped transcript selection; branching never rewinds workflow state."""

from collections.abc import Mapping
from typing import Any, Protocol

from machinery.context import ServiceApiEndUserContext
from machinery.message_history import MessageHistory


class MessageBranchStore(Protocol):
    def get_message_history(
        self,
        *,
        context: ServiceApiEndUserContext,
        conversation_id: str,
        parent_message_id: str | None,
    ) -> MessageHistory:
        """Verify all owners and return at most 500 ancestors, oldest first.

        None selects an empty root. Each ancestor, including a legacy linear
        predecessor, must belong to the admitted owner chain. Missing/cyclic
        references fail without writes. The adapter owns a short read session.
        """
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

        Preconditions: context comes from admission, never request metadata.
        Unsupported modes, missing conversations and the reserved nil UUID fail
        before reading. Success leaves turns, workflow state and effects intact.
        """
        if context.app_mode != "advanced-chat":
            raise ValueError("Explicit message branches are supported only for Advanced Chat apps.")
        if not conversation_id:
            raise ValueError("conversation_id is required when parent_message_id is provided.")
        if parent_message_id == "00000000-0000-0000-0000-000000000000":
            raise ValueError("Select a message ID or null, not the reserved nil parent UUID.")
        return self._messages.get_message_history(
            context=context, conversation_id=conversation_id, parent_message_id=parent_message_id
        )
