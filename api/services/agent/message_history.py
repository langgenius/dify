from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, SerializeAsAny, field_validator

from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)


class AgentMessageHistory(BaseModel):
    provider: str
    model: str
    messages: list[SerializeAsAny[PromptMessage]]

    @field_validator("messages", mode="before")
    @classmethod
    def parse_messages(cls, values: Any) -> list[PromptMessage]:
        message_types = {
            "system": SystemPromptMessage,
            "user": UserPromptMessage,
            "assistant": AssistantPromptMessage,
            "tool": ToolPromptMessage,
        }
        if not isinstance(values, list):
            raise ValueError("Agent history messages must be a list")
        messages = []
        for value in values:
            if isinstance(value, PromptMessage):
                messages.append(value)
            elif isinstance(value, Mapping) and value.get("role") in message_types:
                messages.append(message_types[value["role"]].model_validate(value))
            else:
                raise ValueError("Invalid agent history message role")
        return messages

    def restore(self, *, provider: str, model: str) -> list[PromptMessage] | None:
        if (self.provider, self.model) != (provider, model):
            return None
        messages = list(self.messages)
        pending: dict[str, str] = {}
        for message in messages:
            if isinstance(message, AssistantPromptMessage):
                pending.update((call.id, call.function.name) for call in message.tool_calls)
            elif isinstance(message, ToolPromptMessage):
                pending.pop(message.tool_call_id, None)
        # A stopped run can persist the model response before its tools finish.
        messages.extend(
            ToolPromptMessage(tool_call_id=call_id, name=name, content="Tool execution was interrupted.")
            for call_id, name in pending.items()
        )
        return messages
