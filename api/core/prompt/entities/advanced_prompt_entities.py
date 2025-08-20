from typing import Literal, Optional

from pydantic import BaseModel

from core.model_runtime.entities.message_entities import PromptMessageRole


class ChatModelMessage(BaseModel):
    """
    Chat Message.
    """

    text: str
    role: PromptMessageRole
    edition_type: Optional[Literal["basic", "jinja2"]] = None


class CompletionModelPromptTemplate(BaseModel):
    """
    Completion Model Prompt Template.
    """

    text: str
    edition_type: Optional[Literal["basic", "jinja2"]] = None


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
        size: Optional[int] = None

    mode: Optional[Literal["linear", "block"]] = "linear"
    block_id: Optional[list[str]] = None  # available only in block mode

    role_prefix: Optional[RolePrefix] = None
    window: WindowConfig
    query_prompt_template: Optional[str] = None

    @property
    def is_block_mode(self) -> bool:
        return self.mode == "block" and bool(self.block_id)
