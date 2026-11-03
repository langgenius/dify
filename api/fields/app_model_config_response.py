from datetime import datetime
from typing import Literal, NotRequired, TypedDict

from pydantic import AliasChoices, ConfigDict, Field, JsonValue, field_validator, with_config

from core.entities.agent_entities import PlanningStrategy
from core.rag.entities.metadata_entities import SupportedComparisonOperator
from core.rag.rerank.rerank_type import RerankMode
from core.tools.entities.tool_entities import ToolProviderType
from fields.base import ResponseModel
from graphon.file import FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMMode
from libs.helper import to_timestamp
from models.enums import PromptType


class AppEnabledConfigResponse(TypedDict):
    enabled: bool


@with_config(ConfigDict(extra="allow"))
class AppModelSelectionResponse(TypedDict, total=False):
    provider: str
    name: str
    mode: LLMMode | Literal[""]
    completion_params: dict[str, JsonValue]


class AppSuggestedQuestionsAfterAnswerResponse(TypedDict):
    enabled: bool
    model: NotRequired[AppModelSelectionResponse]
    prompt: NotRequired[str]


class AppTextToSpeechResponse(TypedDict):
    enabled: bool
    voice: NotRequired[str]
    language: NotRequired[str]
    autoPlay: NotRequired[Literal["enabled", "disabled"]]


class AppEmbeddingModelResponse(TypedDict):
    embedding_provider_name: str
    embedding_model_name: str


class AppAnnotationReplyDisabledResponse(TypedDict):
    enabled: Literal[False]


class AppAnnotationReplyEnabledResponse(TypedDict):
    id: str
    enabled: Literal[True]
    score_threshold: float
    embedding_model: AppEmbeddingModelResponse


@with_config(ConfigDict(extra="allow"))
class AppSensitiveWordAvoidanceResponse(TypedDict):
    enabled: bool
    type: NotRequired[str]
    config: NotRequired[dict[str, JsonValue]]
    configs: NotRequired[list[JsonValue]]


@with_config(ConfigDict(extra="allow"))
class AppEnabledExternalDataToolResponse(TypedDict):
    enabled: Literal[True]
    variable: str
    type: str
    config: dict[str, JsonValue]
    label: NotRequired[str]
    icon: NotRequired[str]
    icon_background: NotRequired[str]


@with_config(ConfigDict(extra="allow"))
class AppDisabledExternalDataToolResponse(TypedDict):
    enabled: Literal[False]
    variable: NotRequired[str]
    type: NotRequired[str]
    config: NotRequired[dict[str, JsonValue]]
    label: NotRequired[str]
    icon: NotRequired[str]
    icon_background: NotRequired[str]


@with_config(ConfigDict(extra="allow"))
class AppUserInputFormConfigResponse(TypedDict):
    variable: str
    label: str
    description: NotRequired[str]
    required: NotRequired[bool]
    max_length: NotRequired[int | None]
    options: NotRequired[list[str]]
    default: NotRequired[JsonValue]
    type: NotRequired[str]
    hide: NotRequired[bool]
    allowed_file_types: NotRequired[list[FileType]]
    allowed_file_extensions: NotRequired[list[str]]
    allowed_file_upload_methods: NotRequired[list[FileTransferMethod]]
    json_schema: NotRequired[str | dict[str, JsonValue] | None]
    config: NotRequired[dict[str, JsonValue]]
    enabled: NotRequired[bool]
    icon: NotRequired[str | None]
    icon_background: NotRequired[str | None]


AppTextInputFormResponse = TypedDict("AppTextInputFormResponse", {"text-input": AppUserInputFormConfigResponse})


class AppSelectFormResponse(TypedDict):
    select: AppUserInputFormConfigResponse


class AppParagraphFormResponse(TypedDict):
    paragraph: AppUserInputFormConfigResponse


class AppNumberFormResponse(TypedDict):
    number: AppUserInputFormConfigResponse


class AppCheckboxFormResponse(TypedDict):
    checkbox: AppUserInputFormConfigResponse


class AppFileFormResponse(TypedDict):
    file: AppUserInputFormConfigResponse


AppFileListFormResponse = TypedDict("AppFileListFormResponse", {"file-list": AppUserInputFormConfigResponse})


class AppExternalDataToolFormResponse(TypedDict):
    external_data_tool: AppUserInputFormConfigResponse


class AppJsonObjectFormResponse(TypedDict):
    json_object: AppUserInputFormConfigResponse


AppUserInputFormResponse = (
    AppTextInputFormResponse
    | AppSelectFormResponse
    | AppParagraphFormResponse
    | AppNumberFormResponse
    | AppCheckboxFormResponse
    | AppFileFormResponse
    | AppFileListFormResponse
    | AppExternalDataToolFormResponse
    | AppJsonObjectFormResponse
)


class AppDatasetReferenceResponse(TypedDict, total=False):
    id: str
    enabled: bool


class AppLegacySensitiveWordToolResponse(TypedDict):
    enabled: bool
    words: list[str]
    canned_response: str


@with_config(ConfigDict(extra="allow"))
class AppProviderAgentToolResponse(TypedDict):
    provider_type: ToolProviderType
    provider_id: str
    tool_name: str
    tool_parameters: dict[str, JsonValue]
    provider_name: NotRequired[str]
    tool_label: NotRequired[str]
    plugin_unique_identifier: NotRequired[str | None]
    credential_id: NotRequired[str | None]
    enabled: NotRequired[bool]
    isDeleted: NotRequired[bool]
    notAuthor: NotRequired[bool]


class AppLegacyDatasetToolResponse(TypedDict):
    dataset: AppDatasetReferenceResponse


class AppLegacyGoogleSearchToolResponse(TypedDict):
    google_search: dict[str, JsonValue]


class AppLegacyWebReaderToolResponse(TypedDict):
    web_reader: dict[str, JsonValue]


class AppLegacyWikipediaToolResponse(TypedDict):
    wikipedia: dict[str, JsonValue]


class AppLegacyCurrentDatetimeToolResponse(TypedDict):
    current_datetime: dict[str, JsonValue]


AppLegacySensitiveWordToolResponseItem = TypedDict(
    "AppLegacySensitiveWordToolResponseItem",
    {"sensitive-word-avoidance": AppLegacySensitiveWordToolResponse},
)


AppAgentToolResponse = (
    AppProviderAgentToolResponse
    | AppLegacyDatasetToolResponse
    | AppLegacyGoogleSearchToolResponse
    | AppLegacyWebReaderToolResponse
    | AppLegacyWikipediaToolResponse
    | AppLegacyCurrentDatetimeToolResponse
    | AppLegacySensitiveWordToolResponseItem
)


class AppAgentPromptResponse(TypedDict, total=False):
    first_prompt: str
    next_iteration: str


@with_config(ConfigDict(extra="allow"))
class AppAgentModeResponse(TypedDict):
    enabled: bool
    strategy: NotRequired[PlanningStrategy | Literal["cot", "function-calling"] | None]
    tools: NotRequired[list[AppAgentToolResponse]]
    prompt: NotRequired[AppAgentPromptResponse | str | None]
    max_iteration: NotRequired[int]


class AppChatPromptMessageResponse(TypedDict):
    text: str
    role: str


class AppChatPromptConfigResponse(TypedDict, total=False):
    prompt: list[AppChatPromptMessageResponse]


class AppCompletionPromptTextResponse(TypedDict):
    text: str


class AppConversationHistoriesRoleResponse(TypedDict):
    user_prefix: str
    assistant_prefix: str


class AppCompletionPromptConfigResponse(TypedDict, total=False):
    prompt: AppCompletionPromptTextResponse
    conversation_histories_role: AppConversationHistoriesRoleResponse


class AppDatasetItemResponse(TypedDict):
    dataset: AppDatasetReferenceResponse


class AppDatasetListResponse(TypedDict):
    datasets: list[AppDatasetItemResponse]
    strategy: NotRequired[str]


class AppRerankingModelResponse(TypedDict, total=False):
    reranking_provider_name: str
    reranking_model_name: str


class AppVectorSettingResponse(TypedDict):
    vector_weight: float
    embedding_provider_name: str
    embedding_model_name: str


class AppKeywordSettingResponse(TypedDict):
    keyword_weight: float


class AppWeightsResponse(TypedDict):
    vector_setting: AppVectorSettingResponse
    keyword_setting: AppKeywordSettingResponse
    weight_type: NotRequired[Literal["semantic_first", "keyword_first", "customized"]]


@with_config(ConfigDict(extra="allow"))
class AppMetadataConditionResponse(TypedDict):
    id: NotRequired[str]
    metadata_id: NotRequired[str]
    name: str
    comparison_operator: SupportedComparisonOperator
    value: NotRequired[str | list[str] | int | float | None]


class AppMetadataFilteringConditionsResponse(TypedDict, total=False):
    logical_operator: Literal["and", "or"] | None
    conditions: list[AppMetadataConditionResponse] | None


@with_config(ConfigDict(extra="allow"))
class AppDatasetConfigsResponse(TypedDict):
    retrieval_model: Literal["single", "multiple"]
    datasets: NotRequired[AppDatasetListResponse]
    top_k: NotRequired[int]
    score_threshold: NotRequired[float | None]
    score_threshold_enabled: NotRequired[bool]
    reranking_model: NotRequired[AppRerankingModelResponse | None]
    weights: NotRequired[AppWeightsResponse | None]
    reranking_enabled: NotRequired[bool]
    reranking_enable: NotRequired[bool]
    reranking_mode: NotRequired[RerankMode]
    metadata_filtering_mode: NotRequired[Literal["disabled", "automatic", "manual"]]
    metadata_model_config: NotRequired[AppModelSelectionResponse | None]
    metadata_filtering_conditions: NotRequired[AppMetadataFilteringConditionsResponse | None]


class AppImageUploadResponse(TypedDict, total=False):
    enabled: bool
    number_limits: int
    detail: Literal["low", "high"] | None
    transfer_methods: list[FileTransferMethod]


class AppFileUploadResponse(TypedDict, total=False):
    image: AppImageUploadResponse
    enabled: bool
    allowed_file_types: list[FileType]
    allowed_file_extensions: list[str]
    allowed_file_upload_methods: list[FileTransferMethod]
    number_limits: int


class AppModelConfigResponse(ResponseModel):
    opening_statement: str | None
    suggested_questions: list[str] = Field(
        validation_alias=AliasChoices("suggested_questions_list", "suggested_questions")
    )
    suggested_questions_after_answer: AppSuggestedQuestionsAfterAnswerResponse = Field(
        validation_alias=AliasChoices("suggested_questions_after_answer_dict", "suggested_questions_after_answer"),
    )
    speech_to_text: AppEnabledConfigResponse = Field(
        validation_alias=AliasChoices("speech_to_text_dict", "speech_to_text")
    )
    text_to_speech: AppTextToSpeechResponse = Field(
        validation_alias=AliasChoices("text_to_speech_dict", "text_to_speech")
    )
    retriever_resource: AppEnabledConfigResponse = Field(
        validation_alias=AliasChoices("retriever_resource_dict", "retriever_resource")
    )
    annotation_reply: AppAnnotationReplyEnabledResponse | AppAnnotationReplyDisabledResponse = Field(
        validation_alias=AliasChoices("annotation_reply_dict", "annotation_reply")
    )
    more_like_this: AppEnabledConfigResponse = Field(
        validation_alias=AliasChoices("more_like_this_dict", "more_like_this")
    )
    sensitive_word_avoidance: AppSensitiveWordAvoidanceResponse = Field(
        validation_alias=AliasChoices("sensitive_word_avoidance_dict", "sensitive_word_avoidance")
    )
    external_data_tools: list[AppEnabledExternalDataToolResponse | AppDisabledExternalDataToolResponse] = Field(
        validation_alias=AliasChoices("external_data_tools_list", "external_data_tools")
    )
    model: AppModelSelectionResponse = Field(validation_alias=AliasChoices("model_dict", "model"))
    user_input_form: list[AppUserInputFormResponse] = Field(
        validation_alias=AliasChoices("user_input_form_list", "user_input_form")
    )
    dataset_query_variable: str | None
    pre_prompt: str | None
    agent_mode: AppAgentModeResponse = Field(validation_alias=AliasChoices("agent_mode_dict", "agent_mode"))
    prompt_type: PromptType
    chat_prompt_config: AppChatPromptConfigResponse = Field(
        validation_alias=AliasChoices("chat_prompt_config_dict", "chat_prompt_config")
    )
    completion_prompt_config: AppCompletionPromptConfigResponse = Field(
        validation_alias=AliasChoices("completion_prompt_config_dict", "completion_prompt_config")
    )
    dataset_configs: AppDatasetConfigsResponse = Field(
        validation_alias=AliasChoices("dataset_configs_dict", "dataset_configs")
    )
    file_upload: AppFileUploadResponse = Field(validation_alias=AliasChoices("file_upload_dict", "file_upload"))
    created_by: str | None
    created_at: int
    updated_by: str | None
    updated_at: int

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)
