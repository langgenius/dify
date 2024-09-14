from typing import Literal

from ...core import BaseModel

__all__ = ["FileDeleted"]


class FileDeleted(BaseModel):
    id: str

    deleted: bool

    object: Literal["file"]
