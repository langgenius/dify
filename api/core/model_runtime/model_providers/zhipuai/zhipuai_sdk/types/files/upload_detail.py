from typing import Optional, List, Dict

from ...core import BaseModel


class UploadDetail(BaseModel):
    url: str
    knowledge_type: int
    file_name: Optional[str] = None
    sentence_size: Optional[int] = None
    custom_separator: Optional[List[str]] = None
    callback_url: Optional[str] = None
    callback_header: Optional[Dict[str,str]] = None
