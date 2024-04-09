from typing import Optional

from pydantic import BaseModel

from core.model_runtime.entities.message_entities import PromptMessageRole


class ChatModelMessage(BaseModel):
    """
    Chat Message.
    """
    text: str
    role: PromptMessageRole


class CompletionModelPromptTemplate(BaseModel):
    """
    Completion Model Prompt Template.
    """
    text: str


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

    role_prefix: Optional[RolePrefix] = None
    window: WindowConfig
