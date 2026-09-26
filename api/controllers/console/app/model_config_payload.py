from typing import Literal, NotRequired

from pydantic import BaseModel, ConfigDict, Field, with_config
from typing_extensions import TypedDict

from core.entities.agent_entities import PlanningStrategy
from core.rag.entities.metadata_entities import SupportedComparisonOperator
from core.rag.rerank.rerank_type import RerankMode
from core.tools.entities.tool_entities import ToolProviderType
from graphon.file.enums import FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMMode

# The recursive schema also keeps generated clients from turning JSON values into `any`.
type AppConfigJsonValue = str | int | float | bool | None | list[AppConfigJsonValue] | dict[str, AppConfigJsonValue]


# Mypy does not yet support PEP 728 extra_items; pyrefly and Pydantic check these declarations.
# https://github.com/python/mypy/issues/18176
class AppModelSelectionPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    provider: str
    name: str
    completion_params: dict[str, AppConfigJsonValue]
    mode: NotRequired[str | None]


# These config managers persist nested extensions alongside their known fields.
# Keep those JSON values when an existing configuration is published again.
class AppPromptMessagePayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    text: str
    role: str


class AppChatPromptPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    prompt: NotRequired[list[AppPromptMessagePayload]]


class AppConversationRolesPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    user_prefix: str
    assistant_prefix: str


class AppCompletionPromptTextPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    text: str


class AppCompletionPromptPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    prompt: NotRequired[AppCompletionPromptTextPayload]
    conversation_histories_role: NotRequired[AppConversationRolesPayload]


@with_config(ConfigDict(extra="allow"))
class AppInputFieldBasePayload(TypedDict):
    label: str
    variable: str
    description: NotRequired[str]
    required: NotRequired[bool | None]
    default: NotRequired[AppConfigJsonValue]
    max_length: NotRequired[int | None]
    hide: NotRequired[bool]
    type: NotRequired[str]
    enabled: NotRequired[bool]
    config: NotRequired[dict[str, AppConfigJsonValue]]
    icon: NotRequired[str | None]
    icon_background: NotRequired[str | None]
    json_schema: NotRequired[str | dict[str, AppConfigJsonValue] | None]


class AppInputFieldPayload(AppInputFieldBasePayload, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    options: NotRequired[list[str]]


class AppSelectFieldPayload(AppInputFieldBasePayload, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    options: NotRequired[list[str] | None]


class AppTextInputPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)

    text_input: AppInputFieldPayload = Field(alias="text-input")


class AppSelectInputPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    select: AppSelectFieldPayload


class AppParagraphInputPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    paragraph: AppInputFieldPayload


class AppNumberInputPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    number: AppInputFieldPayload


class AppCheckboxInputPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    checkbox: AppInputFieldPayload


class AppExternalDataInputPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    external_data_tool: AppInputFieldPayload


type AppUserInputFormPayload = (
    AppTextInputPayload
    | AppSelectInputPayload
    | AppParagraphInputPayload
    | AppNumberInputPayload
    | AppCheckboxInputPayload
    | AppExternalDataInputPayload
)


class AppFeaturePayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    enabled: NotRequired[bool | None]


class AppSuggestedQuestionsModelPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    provider: str
    name: str
    mode: NotRequired[LLMMode | Literal[""]]
    completion_params: NotRequired[dict[str, AppConfigJsonValue]]


class AppSuggestedQuestionsPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    enabled: NotRequired[bool | None]
    prompt: NotRequired[str]
    model: NotRequired[AppSuggestedQuestionsModelPayload]


class AppTextToSpeechPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    enabled: NotRequired[bool | None]
    voice: NotRequired[str]
    language: NotRequired[str]
    autoPlay: NotRequired[Literal["enabled", "disabled"]]


class AppModerationContentPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    enabled: NotRequired[bool | None]
    preset_response: NotRequired[str | None]


class AppModerationConfigPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    inputs_config: NotRequired[AppModerationContentPayload | None]
    outputs_config: NotRequired[AppModerationContentPayload | None]
    keywords: NotRequired[str | None]
    api_based_extension_id: NotRequired[str | None]


class AppModerationPayload(BaseModel):
    enabled: bool | None = None
    type: str | None = None
    config: AppModerationConfigPayload | None = None


class AppExternalDataToolPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    enabled: NotRequired[bool | None]
    type: NotRequired[str]
    label: NotRequired[str]
    variable: NotRequired[str]
    config: NotRequired[dict[str, AppConfigJsonValue]]
    icon: NotRequired[str]
    icon_background: NotRequired[str]


class AppDatasetSelectionPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    id: NotRequired[str]
    enabled: NotRequired[bool]


class AppLegacyDatasetSelectionPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    id: NotRequired[str]
    enabled: NotRequired[bool | None]


class AppDatasetToolPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    dataset: AppDatasetSelectionPayload


class AppEmptyDatasetCollectionPayload(TypedDict, closed=True):
    pass


class AppDatasetCollectionPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    strategy: NotRequired[str]
    datasets: list[AppDatasetToolPayload]


class AppRerankingModelPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    reranking_provider_name: NotRequired[str]
    reranking_model_name: NotRequired[str]


class AppVectorWeightPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    vector_weight: float
    embedding_provider_name: str
    embedding_model_name: str


class AppKeywordWeightPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    keyword_weight: float


class AppRetrievalWeightsPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    weight_type: NotRequired[Literal["semantic_first", "keyword_first", "customized"]]
    vector_setting: AppVectorWeightPayload
    keyword_setting: AppKeywordWeightPayload


class AppMetadataModelPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    provider: NotRequired[str]
    name: NotRequired[str]
    mode: NotRequired[LLMMode | Literal[""]]
    completion_params: NotRequired[dict[str, AppConfigJsonValue]]


class AppMetadataConditionPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    id: NotRequired[str]
    name: str
    metadata_id: NotRequired[str]
    comparison_operator: SupportedComparisonOperator
    value: NotRequired[str | int | float | list[str] | None]


class AppMetadataFilteringPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    logical_operator: NotRequired[Literal["and", "or"] | None]
    conditions: NotRequired[list[AppMetadataConditionPayload] | None]


class AppDatasetConfigPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    retrieval_model: NotRequired[Literal["single", "multiple"]]
    datasets: NotRequired[AppDatasetCollectionPayload | AppEmptyDatasetCollectionPayload | None]
    top_k: NotRequired[int]
    score_threshold: NotRequired[float | None]
    score_threshold_enabled: NotRequired[bool]
    reranking_model: NotRequired[AppRerankingModelPayload | None]
    weights: NotRequired[AppRetrievalWeightsPayload | None]
    reranking_enabled: NotRequired[bool]
    reranking_enable: NotRequired[bool]
    reranking_mode: NotRequired[RerankMode]
    metadata_filtering_mode: NotRequired[Literal["disabled", "automatic", "manual"]]
    metadata_model_config: NotRequired[AppMetadataModelPayload | None]
    metadata_filtering_conditions: NotRequired[AppMetadataFilteringPayload | None]


class AppAgentPromptPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    first_prompt: NotRequired[str]
    next_iteration: NotRequired[str]


class AppProviderAgentToolPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    enabled: NotRequired[bool | None]
    provider_type: ToolProviderType
    provider_id: str
    provider_name: NotRequired[str]
    tool_name: str
    tool_label: NotRequired[str]
    tool_parameters: dict[str, AppConfigJsonValue]
    plugin_unique_identifier: NotRequired[str | None]
    credential_id: NotRequired[str | None]
    isDeleted: NotRequired[bool]
    notAuthor: NotRequired[bool]


class AppLegacyDatasetToolPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    dataset: AppLegacyDatasetSelectionPayload


class AppLegacyGoogleSearchToolPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    google_search: AppFeaturePayload


class AppLegacyWebReaderToolPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    web_reader: AppFeaturePayload


class AppLegacyWikipediaToolPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    wikipedia: AppFeaturePayload


class AppLegacyCurrentDatetimeToolPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    current_datetime: AppFeaturePayload


class AppLegacySensitiveWordConfigPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    enabled: bool
    words: list[str]
    canned_response: str


AppLegacySensitiveWordToolPayload = TypedDict(  # type: ignore[misc]
    "AppLegacySensitiveWordToolPayload",
    {"sensitive-word-avoidance": AppLegacySensitiveWordConfigPayload},
    extra_items=AppConfigJsonValue,
)

type AppAgentToolPayload = (
    AppProviderAgentToolPayload
    | AppLegacyDatasetToolPayload
    | AppLegacyGoogleSearchToolPayload
    | AppLegacyWebReaderToolPayload
    | AppLegacyWikipediaToolPayload
    | AppLegacyCurrentDatetimeToolPayload
    | AppLegacySensitiveWordToolPayload
)


class AppAgentModePayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    enabled: NotRequired[bool | None]
    strategy: NotRequired[PlanningStrategy | Literal["cot", "function-calling", ""] | None]
    max_iteration: NotRequired[int]
    tools: NotRequired[list[AppAgentToolPayload] | None]
    prompt: NotRequired[AppAgentPromptPayload | str | None]


class AppImageUploadPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    enabled: NotRequired[bool]
    number_limits: NotRequired[int]
    detail: NotRequired[Literal["low", "high"] | None]
    transfer_methods: NotRequired[list[FileTransferMethod]]


class AppImageConfigPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    number_limits: NotRequired[int]
    detail: NotRequired[Literal["low", "high"] | None]
    transfer_methods: NotRequired[list[FileTransferMethod]]


class AppFileTypeUploadPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    enabled: NotRequired[bool | None]
    number_limits: NotRequired[int | None]
    transfer_methods: NotRequired[list[FileTransferMethod] | None]


class AppFilePreviewPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    mode: NotRequired[str | None]
    file_type_list: NotRequired[list[str] | None]


class AppFileUploadPayload(TypedDict, extra_items=AppConfigJsonValue):  # type: ignore[call-arg]
    enabled: NotRequired[bool]
    image: NotRequired[AppImageUploadPayload]
    image_config: NotRequired[AppImageConfigPayload | None]
    document: NotRequired[AppFileTypeUploadPayload | None]
    audio: NotRequired[AppFileTypeUploadPayload | None]
    video: NotRequired[AppFileTypeUploadPayload | None]
    custom: NotRequired[AppFileTypeUploadPayload | None]
    preview_config: NotRequired[AppFilePreviewPayload | None]
    allowed_file_types: NotRequired[list[FileType]]
    allowed_file_extensions: NotRequired[list[str]]
    allowed_file_upload_methods: NotRequired[list[FileTransferMethod]]
    number_limits: NotRequired[int]


class AppModelConfigPayload(BaseModel):
    """Write transport; app-mode validators own defaults and feature-specific rules."""

    model: AppModelSelectionPayload
    prompt_type: Literal["simple", "advanced", ""] | None = None
    pre_prompt: str | None = None
    chat_prompt_config: AppChatPromptPayload | None = None
    completion_prompt_config: AppCompletionPromptPayload | None = None
    user_input_form: list[AppUserInputFormPayload] | None = None
    dataset_query_variable: str | None = None
    dataset_configs: AppDatasetConfigPayload | None = None
    agent_mode: AppAgentModePayload | None = None
    external_data_tools: list[AppExternalDataToolPayload] | None = None
    file_upload: AppFileUploadPayload | None = None
    opening_statement: str | None = None
    suggested_questions: list[str] | None = None
    suggested_questions_after_answer: AppSuggestedQuestionsPayload | None = None
    more_like_this: AppFeaturePayload | None = None
    speech_to_text: AppFeaturePayload | None = None
    text_to_speech: AppTextToSpeechPayload | None = None
    retriever_resource: AppFeaturePayload | None = None
    sensitive_word_avoidance: AppModerationPayload | None = None
