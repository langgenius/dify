from pydantic import BaseModel
from typing import ClassVar

class RetrievalMethod(BaseModel):
    SEMANTIC_SEARCH: ClassVar[str] = "SEMANTIC_SEARCH"
    KEYWORD_SEARCH: ClassVar[str] = "KEYWORD_SEARCH"
    HYBRID_SEARCH: ClassVar[str] = "HYBRID_SEARCH"
