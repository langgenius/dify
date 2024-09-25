from typing import Literal

from ....core import BaseModel
from .tools.tools_type import ToolsType

__all__ = ["ToolsDeltaBlock"]


class ToolsDeltaBlock(BaseModel):
    tool_calls: list[ToolsType]
    """The index of the content part in the message."""

    role: str = "tool"

    type: Literal["tool_calls"] = "tool_calls"
    """Always `tool_calls`."""
