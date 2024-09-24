from __future__ import annotations

from typing_extensions import TypedDict

__all__ = ["BatchListParams"]


class BatchListParams(TypedDict, total=False):
    after: str
    """分页的游标，用于获取下一页的数据。

    `after` 是一个指向当前页面的游标，用于获取下一页的数据。如果没有提供 `after`，则返回第一页的数据。
    list.
    """

    limit: int
    """这个参数用于限制返回的结果数量。

    Limit 用于限制返回的结果数量。默认值为 10
    """
