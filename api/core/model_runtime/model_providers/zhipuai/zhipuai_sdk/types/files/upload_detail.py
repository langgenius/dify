from typing import Optional

from ...core import BaseModel


class UploadDetail(BaseModel):
    url: str
    knowledge_type: int
    file_name: Optional[str] = None
    sentence_size: Optional[int] = None
    custom_separator: Optional[list[str]] = None
    callback_url: Optional[str] = None
    callback_header: Optional[dict[str, str]] = None
