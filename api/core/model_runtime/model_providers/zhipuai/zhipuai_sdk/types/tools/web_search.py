from typing import Optional

from ...core import BaseModel

__all__ = [
    "WebSearch",
    "SearchIntent",
    "SearchResult",
    "SearchRecommend",
]


class SearchIntent(BaseModel):
    index: int
    # 搜索轮次，默认为 0
    query: str
    # 搜索优化 query
    intent: str
    # 判断的意图类型
    keywords: str
    # 搜索关键词


class SearchResult(BaseModel):
    index: int
    # 搜索轮次，默认为 0
    title: str
    # 标题
    link: str
    # 链接
    content: str
    # 内容
    icon: str
    # 图标
    media: str
    # 来源媒体
    refer: str
    # 角标序号 [ref_1]


class SearchRecommend(BaseModel):
    index: int
    # 搜索轮次，默认为 0
    query: str
    # 推荐query


class WebSearchMessageToolCall(BaseModel):
    id: str
    search_intent: Optional[SearchIntent]
    search_result: Optional[SearchResult]
    search_recommend: Optional[SearchRecommend]
    type: str


class WebSearchMessage(BaseModel):
    role: str
    tool_calls: Optional[list[WebSearchMessageToolCall]] = None


class WebSearchChoice(BaseModel):
    index: int
    finish_reason: str
    message: WebSearchMessage


class WebSearch(BaseModel):
    created: Optional[int] = None
    choices: list[WebSearchChoice]
    request_id: Optional[str] = None
    id: Optional[str] = None
