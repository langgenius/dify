from typing import Optional

from ...core import BaseModel

__all__ = ["KnowledgeStatistics", "KnowledgeUsed"]


class KnowledgeStatistics(BaseModel):
    """
    使用量统计
    """

    word_num: Optional[int] = None
    length: Optional[int] = None


class KnowledgeUsed(BaseModel):
    used: Optional[KnowledgeStatistics] = None
    """已使用量"""
    total: Optional[KnowledgeStatistics] = None
    """知识库总量"""
