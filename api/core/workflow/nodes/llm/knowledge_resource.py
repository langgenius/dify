from typing import Any, Optional

from pydantic import BaseModel


class KnowledgeResource(BaseModel):
    """
    Knowledge Resource.
    """
    content: str
    title: str
    url: Optional[str] = None
    icon: Optional[str] = None
    score: Optional[float] = None
    metadata: Optional[dict[str, Any]] = None

