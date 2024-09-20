import enum
from typing import Any

from pydantic import BaseModel


class PromptMessageFileType(enum.Enum):
    IMAGE = "image"

    @staticmethod
    def value_of(value):
        for member in PromptMessageFileType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class PromptMessageFile(BaseModel):
    type: PromptMessageFileType
    data: Any = None


class ImagePromptMessageFile(PromptMessageFile):
    class DETAIL(enum.Enum):
        LOW = "low"
        HIGH = "high"

    type: PromptMessageFileType = PromptMessageFileType.IMAGE
    detail: DETAIL = DETAIL.LOW
