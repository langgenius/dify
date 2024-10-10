from pydantic import BaseModel
from typing import Optional


class DocumentContext(BaseModel):
    """
    Model class for document context.
    """

    content: str
    score: Optional[float] = None
