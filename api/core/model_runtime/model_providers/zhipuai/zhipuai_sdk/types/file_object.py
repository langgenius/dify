from typing import List, Optional

from pydantic import BaseModel

__all__ = ["FileObject"]


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
    data: List[FileObject]
    has_more: Optional[bool] = None
