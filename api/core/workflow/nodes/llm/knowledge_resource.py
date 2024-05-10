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

    def to_dict(self):
        return {
            'content': self.content,
            'title': self.title,
            'url': self.url,
            'icon': self.icon,
            'score': self.score,
            'metadata': self.metadata
        }
