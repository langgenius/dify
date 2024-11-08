from typing import Optional

from pydantic import BaseModel


class SegmentUpdateEntity(BaseModel):
    content: str
    answer: Optional[str] = None
    keywords: Optional[list[str]] = None
    enabled: Optional[bool] = None
