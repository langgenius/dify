from typing import Optional, TypedDict, Union


class AssistantAttachments:
    file_id: str


class MessageTextContent:
    type: str  # 目前支持 type = text
    text: str


MessageContent = Union[MessageTextContent]


class ConversationMessage(TypedDict):
    """会话消息体"""

    role: str  # 用户的输入角色，例如 'user'
    content: list[MessageContent]  # 会话消息体的内容


class AssistantParameters(TypedDict, total=False):
    """智能体参数类"""

    assistant_id: str  # 智能体 ID
    conversation_id: Optional[str]  # 会话 ID，不传则创建新会话
    model: str  # 模型名称，默认为 'GLM-4-Assistant'
    stream: bool  # 是否支持流式 SSE，需要传入 True
    messages: list[ConversationMessage]  # 会话消息体
    attachments: Optional[list[AssistantAttachments]]  # 会话指定的文件，非必填
    metadata: Optional[dict]  # 元信息，拓展字段，非必填
