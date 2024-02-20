from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

__all__ = ["GeneratedImage", "ImagesResponded"]


class GeneratedImage(BaseModel):
    b64_json: Optional[str] = None
    url: Optional[str] = None
    revised_prompt: Optional[str] = None


class ImagesResponded(BaseModel):
    created: int
    data: list[GeneratedImage]
