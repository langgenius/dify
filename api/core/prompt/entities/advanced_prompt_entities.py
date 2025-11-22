from typing import Literal

from pydantic import BaseModel

from core.model_runtime.entities.message_entities import PromptMessageRole


class ChatModelMessage(BaseModel):
    """
    Chat Message.
    """

    text: str
    role: PromptMessageRole
    edition_type: Literal["basic", "jinja2"] | None = None


class CompletionModelPromptTemplate(BaseModel):
    """
    Completion Model Prompt Template.
    """

    text: str
    edition_type: Literal["basic", "jinja2"] | None = None


class MemoryConfig(BaseModel):
    """
    Memory Config.
    """

    class RolePrefix(BaseModel):
        """
        Role Prefix.
        """

        user: str
        assistant: str

    class WindowConfig(BaseModel):
        """
        Window Config.
        """

        enabled: bool
        size: int | None = None

    role_prefix: RolePrefix | None = None
    window: WindowConfig
    query_prompt_template: str | None = None
    # Memory scope: shared (default, uses TokenBufferMemory), or independent
    # (per-node, persisted in ConversationVariable)
    scope: Literal["shared", "independent"] = "shared"
    # If true, clear the per-node memory after this node finishes execution (only applies to independent scope)
    clear_after_execution: bool = False
