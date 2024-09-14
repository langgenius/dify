from typing import Optional

from ...core import BaseModel
from .web_search import SearchIntent, SearchRecommend, SearchResult

__all__ = ["WebSearchChunk"]


class ChoiceDeltaToolCall(BaseModel):
    index: int
    id: Optional[str] = None

    search_intent: Optional[SearchIntent] = None
    search_result: Optional[SearchResult] = None
    search_recommend: Optional[SearchRecommend] = None
    type: Optional[str] = None


class ChoiceDelta(BaseModel):
    role: Optional[str] = None
    tool_calls: Optional[list[ChoiceDeltaToolCall]] = None


class Choice(BaseModel):
    delta: ChoiceDelta
    finish_reason: Optional[str] = None
    index: int


class WebSearchChunk(BaseModel):
    id: Optional[str] = None
    choices: list[Choice]
    created: Optional[int] = None
