"""Utility functions for LLM generator."""

from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageRole,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)


def deserialize_prompt_messages(messages: list[dict]) -> list[PromptMessage]:
    """
    Deserialize list of dicts to list[PromptMessage].

    Expected format:
        [
            {"role": "user", "content": "..."},
            {"role": "assistant", "content": "..."},
        ]
    """
    result: list[PromptMessage] = []
    for msg in messages:
        role = PromptMessageRole.value_of(msg["role"])
        content = msg.get("content", "")

        match role:
            case PromptMessageRole.USER:
                result.append(UserPromptMessage(content=content))
            case PromptMessageRole.ASSISTANT:
                result.append(AssistantPromptMessage(content=content))
            case PromptMessageRole.SYSTEM:
                result.append(SystemPromptMessage(content=content))
            case PromptMessageRole.TOOL:
                result.append(ToolPromptMessage(content=content, tool_call_id=msg.get("tool_call_id", "")))

    return result


def serialize_prompt_messages(messages: list[PromptMessage]) -> list[dict]:
    """
    Serialize list[PromptMessage] to list of dicts.
    """
    return [{"role": msg.role.value, "content": msg.content} for msg in messages]
