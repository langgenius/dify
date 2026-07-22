import binascii
import json
from collections.abc import Mapping
from typing import Any, Literal

from flask import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
)
from core.entities.embedding_type import EmbeddingInputType
from core.entities.provider_entities import BasicProviderConfig
from core.plugin.utils.http_parser import deserialize_response
from core.workflow.file_reference import is_canonical_file_reference
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageRole,
    PromptMessageTool,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.nodes.llm.entities import ModelConfig as LLMModelConfig
from graphon.nodes.parameter_extractor.entities import (
    ParameterConfig,
)
from graphon.nodes.question_classifier.entities import (
    ClassConfig,
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
    tool_parameters: dict[str, Any]
    credential_id: str | None = None


DatasourceInvocationOperation = Literal[
    "get_online_document_page_content",
    "get_online_document_pages",
    "get_website_crawl",
    "online_drive_browse_files",
    "online_drive_download_file",
    "validate_credentials",
]


class RequestInvokeDatasource(BaseModel):
    """Invoke one installed datasource using a Dify-owned credential reference.

    Raw credentials are intentionally not part of this contract. ``tenant_id`` and
    ``user_id`` are consumed by the inner-API request context, while the remaining
    fields select an installed provider declaration and an operation-specific input.
    """

    tenant_id: str = Field(min_length=1, max_length=512)
    user_id: str = Field(min_length=1, max_length=512)
    provider: str = Field(min_length=1, max_length=768)
    datasource: str = Field(min_length=1, max_length=256)
    datasource_type: DatasourceProviderType
    credential_id: str = Field(min_length=1, max_length=512)
    operation: DatasourceInvocationOperation
    datasource_parameters: dict[str, Any] = Field(default_factory=dict)
    page: GetOnlineDocumentPageContentRequest | None = None
    request: dict[str, Any] | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_operation_payload(self) -> "RequestInvokeDatasource":
        expected_type = {
            "get_online_document_page_content": DatasourceProviderType.ONLINE_DOCUMENT,
            "get_online_document_pages": DatasourceProviderType.ONLINE_DOCUMENT,
            "get_website_crawl": DatasourceProviderType.WEBSITE_CRAWL,
            "online_drive_browse_files": DatasourceProviderType.ONLINE_DRIVE,
            "online_drive_download_file": DatasourceProviderType.ONLINE_DRIVE,
            "validate_credentials": self.datasource_type,
        }[self.operation]
        if self.datasource_type != expected_type:
            raise ValueError(f"{self.operation} requires datasource_type {expected_type.value}")

        page_required = self.operation == "get_online_document_page_content"
        if page_required != (self.page is not None):
            raise ValueError("page is required only for get_online_document_page_content")

        request_required = self.operation in {"online_drive_browse_files", "online_drive_download_file"}
        if request_required != (self.request is not None):
            raise ValueError("request is required only for online-drive operations")

        return self


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
    stream: bool = False

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
    input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT


class MultimodalEmbeddingDocument(BaseModel):
    """A document accepted by a multimodal text-embedding model."""

    content: str
    content_type: str
    file_id: str | None = None

    model_config = ConfigDict(extra="forbid")


class RequestInvokeMultimodalEmbedding(BaseRequestInvokeModel):
    """Request to invoke a multimodal text-embedding model."""

    model_type: ModelType = ModelType.TEXT_EMBEDDING
    documents: list[MultimodalEmbeddingDocument] = Field(min_length=1)
    input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT


class RequestInvokeRerank(BaseRequestInvokeModel):
    """
    Request to invoke rerank
    """

    model_type: ModelType = ModelType.RERANK
    query: str
    docs: list[str]
    score_threshold: float | None = None
    top_n: int | None = None


class RequestListModels(BaseModel):
    """Tenant-scoped query for models that Dify can invoke."""

    model_type: Literal[ModelType.LLM, ModelType.TEXT_EMBEDDING, ModelType.RERANK]
    provider: str | None = None
    model: str | None = None
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=100)

    model_config = ConfigDict(protected_namespaces=())


class InvokableModelCatalogItem(BaseModel):
    """Installed identity and active Dify capability metadata for one model."""

    plugin_id: str
    plugin_unique_identifier: str
    provider: str
    model: str
    model_type: ModelType
    capabilities: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(protected_namespaces=())


class InvokableModelCatalogPage(BaseModel):
    """Offset page returned by the internal model catalog endpoint."""

    items: list[InvokableModelCatalogItem] = Field(default_factory=list)
    next_offset: int | None = None


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
    model: LLMModelConfig
    instruction: str
    query: str


class RequestInvokeQuestionClassifierNode(BaseModel):
    """
    Request to invoke question classifier node
    """

    query: str
    model: LLMModelConfig
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
    data: dict[str, Any] = Field(default_factory=dict)
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
    conversation_id: str | None = None


class RequestDownloadFileMapping(BaseModel):
    """File mapping accepted by trusted download-request control-plane APIs."""

    transfer_method: Literal["local_file", "tool_file", "datasource_file", "remote_url"]
    reference: str | None = None
    url: str | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_locator(self) -> "RequestDownloadFileMapping":
        if self.transfer_method == "remote_url":
            if not self.url:
                raise ValueError("url is required when transfer_method is remote_url")
            if self.reference is not None:
                raise ValueError("reference is not allowed when transfer_method is remote_url")
            return self
        if not self.reference:
            raise ValueError("reference is required for non-remote file mappings")
        if not is_canonical_file_reference(self.reference):
            raise ValueError("reference must be a canonical Dify file reference")
        if self.url is not None:
            raise ValueError("url is not allowed for non-remote file mappings")
        return self


class RequestRequestDownloadFile(BaseModel):
    """Request to resolve a signed download URL for one runtime file mapping."""

    tenant_id: str
    user_id: str
    user_from: Literal["account", "end-user"]
    invoke_from: Literal[
        "service-api",
        "openapi",
        "web-app",
        "trigger",
        "explore",
        "debugger",
        "published",
        "validation",
    ]
    file: RequestDownloadFileMapping
    for_external: bool = True

    model_config = ConfigDict(extra="forbid")


class RequestFetchAppInfo(BaseModel):
    """
    Request to fetch app info
    """

    app_id: str


class TriggerInvokeEventResponse(BaseModel):
    variables: Mapping[str, Any] = Field(default_factory=dict)
    cancelled: bool = Field(default=False)

    model_config = ConfigDict(protected_namespaces=(), arbitrary_types_allowed=True)

    @field_validator("variables", mode="before")
    @classmethod
    def convert_variables(cls, v):
        if isinstance(v, str):
            return json.loads(v)
        else:
            return v


class TriggerSubscriptionResponse(BaseModel):
    subscription: dict[str, Any]


class TriggerValidateProviderCredentialsResponse(BaseModel):
    result: bool


class TriggerDispatchResponse(BaseModel):
    user_id: str
    events: list[str]
    response: Response
    payload: Mapping[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(protected_namespaces=(), arbitrary_types_allowed=True)

    @field_validator("response", mode="before")
    @classmethod
    def convert_response(cls, v: str):
        try:
            return deserialize_response(binascii.unhexlify(v.encode()))
        except Exception as e:
            raise ValueError("Failed to deserialize response from hex string") from e
