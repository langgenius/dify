from typing import List, Optional, Dict, Any

from .message import MessageContent
from ...core import BaseModel

__all__ = [
    "AssistantSupportResp"
]


class AssistantSupport(BaseModel):
    assistant_id: str  # 智能体的 Assistant id，用于智能体会话
    created_at: int  # 创建时间
    updated_at: int  # 更新时间
    name: str  # 智能体名称
    avatar: str  # 智能体头像
    description: str  # 智能体描述
    status: str  # 智能体状态，目前只有 publish
    tools: List[str]  # 智能体支持的工具名
    starter_prompts: List[str]  # 智能体启动推荐的 prompt


class AssistantSupportResp(BaseModel):
    code: int
    msg: str
    data: List[AssistantSupport]  # 智能体列表
