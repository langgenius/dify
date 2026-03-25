from typing import Literal

from pydantic import BaseModel

from dify_graph.model_runtime.entities.message_entities import PromptMessageRole


class ChatModelMessage(BaseModel):
    """Graph-owned chat prompt template message."""

    text: str
    role: PromptMessageRole
    edition_type: Literal["basic", "jinja2"] | None = None


class CompletionModelPromptTemplate(BaseModel):
    """Graph-owned completion prompt template."""

    text: str
    edition_type: Literal["basic", "jinja2"] | None = None


class MemoryConfig(BaseModel):
    """Graph-owned memory configuration for prompt assembly."""

    class RolePrefix(BaseModel):
        """Role labels used when serializing completion-model histories."""

        user: str
        assistant: str

    class WindowConfig(BaseModel):
        """History windowing controls."""

        enabled: bool
        size: int | None = None

    role_prefix: RolePrefix | None = None
    window: WindowConfig
    query_prompt_template: str | None = None


__all__ = [
    "ChatModelMessage",
    "CompletionModelPromptTemplate",
    "MemoryConfig",
]
