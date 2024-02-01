from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel

__all__ = ["GeneratedImage", "ImagesResponded"]


class GeneratedImage(BaseModel):
    b64_json: Optional[str] = None
    url: Optional[str] = None
    revised_prompt: Optional[str] = None


class ImagesResponded(BaseModel):
    created: int
    data: List[GeneratedImage]
