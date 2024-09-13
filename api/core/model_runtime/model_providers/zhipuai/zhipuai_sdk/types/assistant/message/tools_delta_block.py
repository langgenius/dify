from typing import Optional, List
from typing_extensions import Literal

from .tools.tools_type import ToolsType
from ....core import BaseModel

__all__ = ["ToolsDeltaBlock"]


class ToolsDeltaBlock(BaseModel):
    tool_calls: List[ToolsType]
    """The index of the content part in the message."""

    role: str = "tool"

    type: Literal["tool_calls"] = "tool_calls"
    """Always `tool_calls`."""
