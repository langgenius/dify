from typing import Any, Optional

from ...core import BaseModel
from .message import MessageContent

__all__ = ["AssistantCompletion", "CompletionUsage"]


class ErrorInfo(BaseModel):
    code: str  # 错误码
    message: str  # 错误信息


class AssistantChoice(BaseModel):
    index: int  # 结果下标
    delta: MessageContent  # 当前会话输出消息体
    finish_reason: str
    """
    # 推理结束原因 stop代表推理自然结束或触发停止词。  sensitive 代表模型推理内容被安全审核接口拦截。请注意，针对此类内容，请用户自行判断并决定是否撤回已公开的内容。 
    # network_error 代表模型推理服务异常。
    """  # noqa: E501
    metadata: dict  # 元信息，拓展字段


class CompletionUsage(BaseModel):
    prompt_tokens: int  # 输入的 tokens 数量
    completion_tokens: int  # 输出的 tokens 数量
    total_tokens: int  # 总 tokens 数量


class AssistantCompletion(BaseModel):
    id: str  # 请求 ID
    conversation_id: str  # 会话 ID
    assistant_id: str  # 智能体 ID
    created: int  # 请求创建时间，Unix 时间戳
    status: str  # 返回状态，包括：`completed` 表示生成结束`in_progress`表示生成中 `failed` 表示生成异常
    last_error: Optional[ErrorInfo]  # 异常信息
    choices: list[AssistantChoice]  # 增量返回的信息
    metadata: Optional[dict[str, Any]]  # 元信息，拓展字段
    usage: Optional[CompletionUsage]  # tokens 数量统计
