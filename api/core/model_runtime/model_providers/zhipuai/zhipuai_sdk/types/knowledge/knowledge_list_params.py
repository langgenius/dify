from __future__ import annotations

from typing import Dict, Optional
from typing_extensions import Literal, Required, TypedDict

__all__ = ["KnowledgeListParams"]


class KnowledgeListParams(TypedDict, total=False):
    page: int = 1
    """ 页码，默认 1，第一页
    """

    size: int = 10
    """每页数量 默认10
    """
