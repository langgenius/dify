from __future__ import annotations

from typing import Optional

from typing_extensions import TypedDict


class DocumentListParams(TypedDict, total=False):
    """
    文件查询参数类型定义

    Attributes:
        purpose (Optional[str]): 文件用途
        knowledge_id (Optional[str]): 当文件用途为 retrieval 时，需要提供查询的知识库ID
        page (Optional[int]): 页，默认1
        limit (Optional[int]): 查询文件列表数，默认10
        after (Optional[str]): 查询指定fileID之后的文件列表（当文件用途为 fine-tune 时需要）
        order (Optional[str]): 排序规则，可选值['desc', 'asc']，默认desc（当文件用途为 fine-tune 时需要）
    """

    purpose: Optional[str]
    knowledge_id: Optional[str]
    page: Optional[int]
    limit: Optional[int]
    after: Optional[str]
    order: Optional[str]
