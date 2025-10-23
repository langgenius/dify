from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.entities.provider_entities import BasicProviderConfig
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
from core.workflow.nodes.parameter_extractor.entities import (
    ModelConfig as ParameterExtractorModelConfig,
)
from core.workflow.nodes.parameter_extractor.entities import (
    ParameterConfig,
)
from core.workflow.nodes.question_classifier.entities import (
    ClassConfig,
)
from core.workflow.nodes.question_classifier.entities import (
    ModelConfig as QuestionClassifierModelConfig,
)


class InvokeCredentials(BaseModel):
    tool_credentials: dict[str, str] = Field(
        default_factory=dict,
        description="Map of tool provider to credential id, used to store the credential id for the tool provider.",
    )


class PluginInvokeContext(BaseModel):
    credentials: InvokeCredentials | None = Field(
        default_factory=InvokeCredentials,
        description="Credentials context for the plugin invocation or backward invocation.",
    )


class RequestInvokeTool(BaseModel):
    """
    Request to invoke a tool
    """

    tool_type: Literal["builtin", "workflow", "api", "mcp"]
    provider: str
    tool: str
    tool_parameters: dict
    credential_id: str | None = None


class BaseRequestInvokeModel(BaseModel):
    provider: str
    model: str
    model_type: ModelType

    model_config = ConfigDict(protected_namespaces=())


class RequestInvokeLLM(BaseRequestInvokeModel):
    """
    Request to invoke LLM
    """

    model_type: ModelType = ModelType.LLM
    mode: str
    completion_params: dict[str, Any] = Field(default_factory=dict)
    prompt_messages: list[PromptMessage] = Field(default_factory=list)
    tools: list[PromptMessageTool] | None = Field(default_factory=list[PromptMessageTool])
    stop: list[str] | None = Field(default_factory=list[str])
    stream: bool | None = False

    model_config = ConfigDict(protected_namespaces=())

    @field_validator("prompt_messages", mode="before")
    @classmethod
    def convert_prompt_messages(cls, v):
        if not isinstance(v, list):
            raise ValueError("prompt_messages must be a list")

        for i in range(len(v)):
            if v[i]["role"] == PromptMessageRole.USER:
                v[i] = UserPromptMessage.model_validate(v[i])
            elif v[i]["role"] == PromptMessageRole.ASSISTANT:
                v[i] = AssistantPromptMessage.model_validate(v[i])
            elif v[i]["role"] == PromptMessageRole.SYSTEM:
                v[i] = SystemPromptMessage.model_validate(v[i])
            elif v[i]["role"] == PromptMessageRole.TOOL:
                v[i] = ToolPromptMessage.model_validate(v[i])
            else:
                v[i] = PromptMessage.model_validate(v[i])

        return v


class RequestInvokeLLMWithStructuredOutput(RequestInvokeLLM):
    """
    Request to invoke LLM with structured output
    """

    structured_output_schema: dict[str, Any] = Field(
        default_factory=dict, description="The schema of the structured output in JSON schema format"
    )


class RequestInvokeTextEmbedding(BaseRequestInvokeModel):
    """
    Request to invoke text embedding
    """

    model_type: ModelType = ModelType.TEXT_EMBEDDING
    texts: list[str]


class RequestInvokeRerank(BaseRequestInvokeModel):
    """
    Request to invoke rerank
    """

    model_type: ModelType = ModelType.RERANK
    query: str
    docs: list[str]
    score_threshold: float
    top_n: int


class RequestInvokeTTS(BaseRequestInvokeModel):
    """
    Request to invoke TTS
    """

    model_type: ModelType = ModelType.TTS
    content_text: str
    voice: str


class RequestInvokeSpeech2Text(BaseRequestInvokeModel):
    """
    Request to invoke speech2text
    """

    model_type: ModelType = ModelType.SPEECH2TEXT
    file: bytes

    @field_validator("file", mode="before")
    @classmethod
    def convert_file(cls, v):
        # hex string to bytes
        if isinstance(v, str):
            return bytes.fromhex(v)
        else:
            raise ValueError("file must be a hex string")


class RequestInvokeModeration(BaseRequestInvokeModel):
    """
    Request to invoke moderation
    """

    model_type: ModelType = ModelType.MODERATION
    text: str


class RequestInvokeParameterExtractorNode(BaseModel):
    """
    Request to invoke parameter extractor node
    """

    parameters: list[ParameterConfig]
    model: ParameterExtractorModelConfig
    instruction: str
    query: str


class RequestInvokeQuestionClassifierNode(BaseModel):
    """
    Request to invoke question classifier node
    """

    query: str
    model: QuestionClassifierModelConfig
    classes: list[ClassConfig]
    instruction: str


class RequestInvokeApp(BaseModel):
    """
    Request to invoke app
    """

    app_id: str
    inputs: dict[str, Any]
    query: str | None = None
    response_mode: Literal["blocking", "streaming"]
    conversation_id: str | None = None
    user: str | None = None
    files: list[dict] = Field(default_factory=list)


class RequestInvokeEncrypt(BaseModel):
    """
    Request to encryption
    """

    opt: Literal["encrypt", "decrypt", "clear"]
    namespace: Literal["endpoint"]
    identity: str
    data: dict = Field(default_factory=dict)
    config: list[BasicProviderConfig] = Field(default_factory=list)


class RequestInvokeSummary(BaseModel):
    """
    Request to summary
    """

    text: str
    instruction: str


class RequestRequestUploadFile(BaseModel):
    """
    Request to upload file
    """

    filename: str
    mimetype: str


class RequestFetchAppInfo(BaseModel):
    """
    Request to fetch app info
    """

    app_id: str
