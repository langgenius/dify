from typing import Literal

from ....core import BaseModel

__all__ = ["TextContentBlock"]


class TextContentBlock(BaseModel):
    content: str

    role: str = "assistant"

    type: Literal["content"] = "content"
    """Always `content`."""
