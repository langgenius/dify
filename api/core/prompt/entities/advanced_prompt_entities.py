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

    mode: Literal["linear", "block"] | None = "linear"
    block_id: list[str] | None = None
    role_prefix: RolePrefix | None = None
    window: WindowConfig
    query_prompt_template: str | None = None

    @property
    def is_block_mode(self) -> bool:
        return self.mode == "block" and bool(self.block_id)
