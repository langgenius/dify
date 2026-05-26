"""Serializable pydantic-ai conversation history layer.

This layer keeps pydantic-ai ``ModelMessage`` history inside Agenton's
serializable ``runtime_state`` so compositor session snapshots can persist and
restore typed messages without any separate storage protocol. The layer is
intentionally state-only: it contributes no system prompts, user prompts, or
tools, and it owns no live resources. Integrations should read
``message_history`` before ``Agent.run(message_history=...)`` and then write
back only the history shape they intend to persist after success, for example
replacing with ``result.all_messages()`` or appending only
``result.new_messages()`` when temporary prompt prefixes must stay ephemeral.
"""

from collections.abc import Sequence
from typing import ClassVar, Final

from pydantic import BaseModel, ConfigDict, Field
from pydantic_ai.messages import ModelMessage

from agenton.layers import EmptyLayerConfig, NoLayerDeps, PydanticAILayer


PYDANTIC_AI_HISTORY_LAYER_TYPE_ID: Final[str] = "pydantic_ai.history"


class PydanticAIHistoryRuntimeState(BaseModel):
    """Serializable history state stored in Agenton session snapshots."""

    messages: list[ModelMessage] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", validate_assignment=True)


class PydanticAIHistoryLayer(PydanticAILayer[NoLayerDeps, object, EmptyLayerConfig, PydanticAIHistoryRuntimeState]):
    """State-only layer that stores pydantic-ai message history.

    The mutable history lives only in ``runtime_state.messages``. Helper methods
    always assign fresh lists instead of mutating the stored list in place so
    Pydantic assignment validation continues to guard the serialized state.
    """

    type_id: ClassVar[str | None] = PYDANTIC_AI_HISTORY_LAYER_TYPE_ID

    @property
    def message_history(self) -> list[ModelMessage]:
        """Return a shallow copy of the stored message history."""
        return list(self.runtime_state.messages)

    def replace_messages(self, messages: Sequence[ModelMessage]) -> None:
        """Replace the stored history with a validated copy of ``messages``."""
        self.runtime_state.messages = list(messages)

    def append_messages(self, messages: Sequence[ModelMessage]) -> None:
        """Append ``messages`` while keeping assignment validation on write."""
        self.runtime_state.messages = [*self.runtime_state.messages, *messages]

    def clear(self) -> None:
        """Remove all stored history messages."""
        self.runtime_state.messages = []


__all__ = [
    "PYDANTIC_AI_HISTORY_LAYER_TYPE_ID",
    "PydanticAIHistoryLayer",
    "PydanticAIHistoryRuntimeState",
]
