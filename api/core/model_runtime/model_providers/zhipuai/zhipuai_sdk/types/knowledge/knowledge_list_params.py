from __future__ import annotations

from typing_extensions import TypedDict

__all__ = ["KnowledgeListParams"]


class KnowledgeListParams(TypedDict, total=False):
    page: int = 1
    """ 页码，默认 1，第一页
    """

    size: int = 10
    """每页数量 默认10
    """
