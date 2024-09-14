from typing import Optional

from ...core import BaseModel

__all__ = ["FileObject", "ListOfFileObject"]


class FileObject(BaseModel):
    id: Optional[str] = None
    bytes: Optional[int] = None
    created_at: Optional[int] = None
    filename: Optional[str] = None
    object: Optional[str] = None
    purpose: Optional[str] = None
    status: Optional[str] = None
    status_details: Optional[str] = None


class ListOfFileObject(BaseModel):
    object: Optional[str] = None
    data: list[FileObject]
    has_more: Optional[bool] = None
