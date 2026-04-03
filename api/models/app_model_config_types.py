"""TypedDict definitions for AppModelConfig structured dict return types."""

from typing import Any, Literal, NotRequired, TypedDict


class EnabledConfig(TypedDict):
    enabled: bool


class EmbeddingModelInfo(TypedDict):
    embedding_provider_name: str
    embedding_model_name: str


class AnnotationReplyDisabledConfig(TypedDict):
    enabled: Literal[False]


class AnnotationReplyEnabledConfig(TypedDict):
    id: str
    enabled: Literal[True]
    score_threshold: float
    embedding_model: EmbeddingModelInfo


AnnotationReplyConfig = AnnotationReplyEnabledConfig | AnnotationReplyDisabledConfig


class SensitiveWordAvoidanceConfig(TypedDict):
    enabled: bool
    type: str
    config: dict[str, Any]


class AgentToolConfig(TypedDict):
    provider_type: str
    provider_id: str
    tool_name: str
    tool_parameters: dict[str, Any]
    plugin_unique_identifier: NotRequired[str | None]
    credential_id: NotRequired[str | None]


class AgentModeConfig(TypedDict):
    enabled: bool
    strategy: str | None
    tools: list[AgentToolConfig | dict[str, Any]]
    prompt: str | None


class ImageUploadConfig(TypedDict):
    enabled: bool
    number_limits: int
    detail: str
    transfer_methods: list[str]


class FileUploadConfig(TypedDict):
    image: ImageUploadConfig


class DeletedToolInfo(TypedDict):
    type: str
    tool_name: str
    provider_id: str


class ExternalDataToolConfig(TypedDict):
    enabled: bool
    variable: str
    type: str
    config: dict[str, Any]


class UserInputFormItemConfig(TypedDict):
    variable: str
    label: str
    description: NotRequired[str]
    required: NotRequired[bool]
    max_length: NotRequired[int]
    options: NotRequired[list[str]]
    default: NotRequired[str]
    type: NotRequired[str]
    config: NotRequired[dict[str, Any]]


# Each item is a single-key dict, e.g. {"text-input": UserInputFormItemConfig}
UserInputFormItem = dict[str, UserInputFormItemConfig]


class DatasetConfigs(TypedDict):
    retrieval_model: str
    datasets: NotRequired[dict[str, Any]]
    top_k: NotRequired[int]
    score_threshold: NotRequired[float]
    score_threshold_enabled: NotRequired[bool]
    reranking_model: NotRequired[dict[str, Any] | None]
    weights: NotRequired[dict[str, Any] | None]
    reranking_enabled: NotRequired[bool]
    reranking_mode: NotRequired[str]
    metadata_filtering_mode: NotRequired[str]
    metadata_model_config: NotRequired[dict[str, Any] | None]
    metadata_filtering_conditions: NotRequired[dict[str, Any] | None]


class ChatPromptMessage(TypedDict):
    text: str
    role: str


class ChatPromptConfig(TypedDict, total=False):
    prompt: list[ChatPromptMessage]


class CompletionPromptText(TypedDict):
    text: str


class ConversationHistoriesRole(TypedDict):
    user_prefix: str
    assistant_prefix: str


class CompletionPromptConfig(TypedDict):
    prompt: CompletionPromptText
    conversation_histories_role: NotRequired[ConversationHistoriesRole]


class ModelConfig(TypedDict):
    provider: str
    name: str
    mode: str
    completion_params: NotRequired[dict[str, Any]]


class AppModelConfigDict(TypedDict):
    opening_statement: str | None
    suggested_questions: list[str]
    suggested_questions_after_answer: EnabledConfig
    speech_to_text: EnabledConfig
    text_to_speech: EnabledConfig
    retriever_resource: EnabledConfig
    annotation_reply: AnnotationReplyConfig
    more_like_this: EnabledConfig
    sensitive_word_avoidance: SensitiveWordAvoidanceConfig
    external_data_tools: list[ExternalDataToolConfig]
    model: ModelConfig
    user_input_form: list[UserInputFormItem]
    dataset_query_variable: str | None
    pre_prompt: str | None
    agent_mode: AgentModeConfig
    prompt_type: str
    chat_prompt_config: ChatPromptConfig
    completion_prompt_config: CompletionPromptConfig
    dataset_configs: DatasetConfigs
    file_upload: FileUploadConfig
    # Added dynamically in Conversation.model_config
    model_id: NotRequired[str | None]
    provider: NotRequired[str | None]
