from ...core import BaseModel

__all__ = ["ConversationUsageListResp"]


class Usage(BaseModel):
    prompt_tokens: int  # 用户输入的 tokens 数量
    completion_tokens: int  # 模型输入的 tokens 数量
    total_tokens: int  # 总 tokens 数量


class ConversationUsage(BaseModel):
    id: str  # 会话 id
    assistant_id: str  # 智能体Assistant id
    create_time: int  # 创建时间
    update_time: int  # 更新时间
    usage: Usage  # 会话中 tokens 数量统计


class ConversationUsageList(BaseModel):
    assistant_id: str  # 智能体id
    has_more: bool  # 是否还有更多页
    conversation_list: list[ConversationUsage]  # 返回的


class ConversationUsageListResp(BaseModel):
    code: int
    msg: str
    data: ConversationUsageList
