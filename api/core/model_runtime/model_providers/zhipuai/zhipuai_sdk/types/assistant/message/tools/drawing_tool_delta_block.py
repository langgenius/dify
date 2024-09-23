from typing import Literal

from .....core import BaseModel

__all__ = ["DrawingToolBlock"]


class DrawingToolOutput(BaseModel):
    image: str


class DrawingTool(BaseModel):
    input: str
    outputs: list[DrawingToolOutput]


class DrawingToolBlock(BaseModel):
    drawing_tool: DrawingTool

    type: Literal["drawing_tool"]
    """Always `drawing_tool`."""
