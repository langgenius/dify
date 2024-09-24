from typing import Optional

from ...core import BaseModel

__all__ = ["KnowledgeInfo"]


class KnowledgeInfo(BaseModel):
    id: Optional[str] = None
    """知识库唯一 id"""
    embedding_id: Optional[str] = (
        None  # 知识库绑定的向量化模型 见模型列表 [内部服务开放接口文档](https://lslfd0slxc.feishu.cn/docx/YauWdbBiMopV0FxB7KncPWCEn8f#H15NduiQZo3ugmxnWQFcfAHpnQ4)
    )
    name: Optional[str] = None  # 知识库名称 100字限制
    customer_identifier: Optional[str] = None  # 用户标识 长度32位以内
    description: Optional[str] = None  # 知识库描述 500字限制
    background: Optional[str] = None  # 背景颜色（给枚举）'blue', 'red', 'orange', 'purple', 'sky'
    icon: Optional[str] = (
        None  # 知识库图标（给枚举） question: 问号、book: 书籍、seal: 印章、wrench: 扳手、tag: 标签、horn: 喇叭、house: 房子  # noqa: E501
    )
    bucket_id: Optional[str] = None  # 桶id 限制32位
