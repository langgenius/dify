from ..core import BaseModel

__all__ = ["BatchRequestCounts"]


class BatchRequestCounts(BaseModel):
    completed: int
    """这个数字表示已经完成的请求。"""

    failed: int
    """这个数字表示失败的请求。"""

    total: int
    """这个数字表示总的请求。"""
