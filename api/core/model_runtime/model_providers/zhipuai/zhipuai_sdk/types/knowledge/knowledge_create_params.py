from __future__ import annotations

from typing import Literal, Optional

from typing_extensions import TypedDict

__all__ = ["KnowledgeBaseParams"]


class KnowledgeBaseParams(TypedDict):
    """
    知识库参数类型定义

    Attributes:
        embedding_id (int): 知识库绑定的向量化模型ID
        name (str): 知识库名称，限制100字
        customer_identifier (Optional[str]): 用户标识，长度32位以内
        description (Optional[str]): 知识库描述，限制500字
        background (Optional[Literal['blue', 'red', 'orange', 'purple', 'sky']]): 背景颜色
        icon (Optional[Literal['question', 'book', 'seal', 'wrench', 'tag', 'horn', 'house']]): 知识库图标
        bucket_id (Optional[str]): 桶ID，限制32位
    """

    embedding_id: int
    name: str
    customer_identifier: Optional[str]
    description: Optional[str]
    background: Optional[Literal["blue", "red", "orange", "purple", "sky"]] = None
    icon: Optional[Literal["question", "book", "seal", "wrench", "tag", "horn", "house"]] = None
    bucket_id: Optional[str]
