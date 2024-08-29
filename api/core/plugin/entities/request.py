from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageRole,
    PromptMessageTool,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import ModelType


class RequestInvokeTool(BaseModel):
    """
    Request to invoke a tool
    """


class BaseRequestInvokeModel(BaseModel):
    provider: str
    model: str
    model_type: ModelType


class RequestInvokeLLM(BaseRequestInvokeModel):
    """
    Request to invoke LLM
    """

    model_type: ModelType = ModelType.LLM
    mode: str
    model_parameters: dict[str, Any] = Field(default_factory=dict)
    prompt_messages: list[PromptMessage]
    tools: Optional[list[PromptMessageTool]] = Field(default_factory=list)
    stop: Optional[list[str]] = Field(default_factory=list)
    stream: Optional[bool] = False

    @field_validator('prompt_messages', mode='before')
    def convert_prompt_messages(cls, v):
        if not isinstance(v, list):
            raise ValueError('prompt_messages must be a list')

        for i in range(len(v)):
            if v[i]['role'] == PromptMessageRole.USER.value:
                v[i] = UserPromptMessage(**v[i])
            elif v[i]['role'] == PromptMessageRole.ASSISTANT.value:
                v[i] = AssistantPromptMessage(**v[i])
            elif v[i]['role'] == PromptMessageRole.SYSTEM.value:
                v[i] = SystemPromptMessage(**v[i])
            elif v[i]['role'] == PromptMessageRole.TOOL.value:
                v[i] = ToolPromptMessage(**v[i])
            else:
                v[i] = PromptMessage(**v[i])

        return v


class RequestInvokeTextEmbedding(BaseModel):
    """
    Request to invoke text embedding
    """


class RequestInvokeRerank(BaseModel):
    """
    Request to invoke rerank
    """


class RequestInvokeTTS(BaseModel):
    """
    Request to invoke TTS
    """


class RequestInvokeSpeech2Text(BaseModel):
    """
    Request to invoke speech2text
    """


class RequestInvokeModeration(BaseModel):
    """
    Request to invoke moderation
    """


class RequestInvokeNode(BaseModel):
    """
    Request to invoke node
    """

class RequestInvokeApp(BaseModel):
    """
    Request to invoke app
    """
    app_id: str
    inputs: dict[str, Any]
    query: Optional[str] = None
    response_mode: Literal["blocking", "streaming"]
    conversation_id: Optional[str] = None
    user: Optional[str] = None
    files: list[dict] = Field(default_factory=list)
