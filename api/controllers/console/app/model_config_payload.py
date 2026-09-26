from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from graphon.file.enums import FileTransferMethod, FileType

# The recursive schema also keeps generated clients from turning JSON values into `any`.
type AppConfigJsonValue = str | int | float | bool | None | list[AppConfigJsonValue] | dict[str, AppConfigJsonValue]


class AppExtensibleConfigPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    # Pydantic requires a dict annotation for typed extras, despite BaseModel's nullable attribute.
    # https://docs.pydantic.dev/latest/api/config/#pydantic.config.ConfigDict.extra
    # pyrefly: ignore[bad-override-mutable-attribute]
    __pydantic_extra__: dict[str, AppConfigJsonValue] = Field(init=False)


class AppModelSelectionPayload(AppExtensibleConfigPayload):
    provider: str
    name: str
    completion_params: dict[str, AppConfigJsonValue]
    mode: str | None = None


# These config managers persist nested extensions alongside their known fields.
# Keep those JSON values when an existing configuration is published again.
class AppPromptMessagePayload(AppExtensibleConfigPayload):
    text: str
    role: str | None = None


class AppChatPromptPayload(AppExtensibleConfigPayload):
    prompt: list[AppPromptMessagePayload] | None = None


class AppConversationRolesPayload(AppExtensibleConfigPayload):
    user_prefix: str | None = None
    assistant_prefix: str | None = None


class AppCompletionPromptPayload(AppExtensibleConfigPayload):
    prompt: AppPromptMessagePayload | None = None
    conversation_histories_role: AppConversationRolesPayload | None = None


class AppInputFieldPayload(AppExtensibleConfigPayload):
    label: str
    variable: str
    description: str | None = None
    required: bool | None = None
    default: AppConfigJsonValue = None
    max_length: int | None = None
    options: list[str] | None = None
    hide: bool | None = None
    type: str | None = None
    enabled: bool | None = None
    config: dict[str, AppConfigJsonValue] | None = None
    icon: str | None = None
    icon_background: str | None = None
    json_schema: str | dict[str, AppConfigJsonValue] | None = None


class AppTextInputPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)

    text_input: AppInputFieldPayload = Field(alias="text-input")


class AppSelectInputPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    select: AppInputFieldPayload


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


class AppFeaturePayload(AppExtensibleConfigPayload):
    enabled: bool | None = None


class AppSuggestedQuestionsModelPayload(AppExtensibleConfigPayload):
    provider: str
    name: str
    mode: str | None = None
    completion_params: dict[str, AppConfigJsonValue] | None = None


class AppSuggestedQuestionsPayload(AppExtensibleConfigPayload):
    enabled: bool | None = None
    prompt: str | None = None
    model: AppSuggestedQuestionsModelPayload | None = None


class AppTextToSpeechPayload(AppExtensibleConfigPayload):
    enabled: bool | None = None
    voice: str | None = None
    language: str | None = None
    autoPlay: Literal["enabled", "disabled"] | None = None


class AppModerationContentPayload(AppExtensibleConfigPayload):
    enabled: bool | None = None
    preset_response: str | None = None


class AppModerationConfigPayload(AppExtensibleConfigPayload):
    inputs_config: AppModerationContentPayload | None = None
    outputs_config: AppModerationContentPayload | None = None
    keywords: str | None = None
    api_based_extension_id: str | None = None


class AppModerationPayload(BaseModel):
    enabled: bool | None = None
    type: str | None = None
    config: AppModerationConfigPayload | None = None


class AppExternalDataToolPayload(AppExtensibleConfigPayload):
    enabled: bool | None = None
    type: str | None = None
    label: str | None = None
    variable: str | None = None
    config: dict[str, AppConfigJsonValue] | None = None
    icon: str | None = None
    icon_background: str | None = None


class AppDatasetSelectionPayload(AppExtensibleConfigPayload):
    id: str | None = None
    enabled: bool | None = None


class AppDatasetToolPayload(AppExtensibleConfigPayload):
    dataset: AppDatasetSelectionPayload | None = None


class AppDatasetCollectionPayload(AppExtensibleConfigPayload):
    strategy: str | None = None
    datasets: list[AppDatasetToolPayload] | None = None


class AppRerankingModelPayload(AppExtensibleConfigPayload):
    reranking_provider_name: str | None = None
    reranking_model_name: str | None = None


class AppVectorWeightPayload(AppExtensibleConfigPayload):
    vector_weight: float | None = None
    embedding_provider_name: str | None = None
    embedding_model_name: str | None = None


class AppKeywordWeightPayload(AppExtensibleConfigPayload):
    keyword_weight: float | None = None


class AppRetrievalWeightsPayload(AppExtensibleConfigPayload):
    weight_type: str | None = None
    vector_setting: AppVectorWeightPayload | None = None
    keyword_setting: AppKeywordWeightPayload | None = None


class AppMetadataModelPayload(AppExtensibleConfigPayload):
    provider: str | None = None
    name: str | None = None
    mode: str | None = None
    completion_params: dict[str, AppConfigJsonValue] | None = None


class AppMetadataConditionPayload(AppExtensibleConfigPayload):
    id: str | None = None
    name: str | None = None
    metadata_id: str | None = None
    comparison_operator: str | None = None
    value: str | int | float | list[str] | None = None


class AppMetadataFilteringPayload(AppExtensibleConfigPayload):
    logical_operator: str | None = None
    conditions: list[AppMetadataConditionPayload] | None = None


class AppDatasetConfigPayload(AppExtensibleConfigPayload):
    retrieval_model: str | None = None
    datasets: AppDatasetCollectionPayload | None = None
    top_k: int | None = None
    score_threshold: float | None = None
    score_threshold_enabled: bool | None = None
    reranking_model: AppRerankingModelPayload | None = None
    weights: AppRetrievalWeightsPayload | None = None
    reranking_enabled: bool | None = None
    reranking_enable: bool | None = None
    reranking_mode: str | None = None
    metadata_filtering_mode: str | None = None
    metadata_model_config: AppMetadataModelPayload | None = None
    metadata_filtering_conditions: AppMetadataFilteringPayload | None = None


class AppAgentPromptPayload(AppExtensibleConfigPayload):
    first_prompt: str | None = None
    next_iteration: str | None = None


class AppAgentToolPayload(AppExtensibleConfigPayload):
    enabled: bool | None = None
    provider_type: str | None = None
    provider_id: str | None = None
    provider_name: str | None = None
    tool_name: str | None = None
    tool_label: str | None = None
    tool_parameters: dict[str, AppConfigJsonValue] | None = None
    plugin_unique_identifier: str | None = None
    credential_id: str | None = None
    isDeleted: bool | None = None
    notAuthor: bool | None = None
    dataset: AppDatasetSelectionPayload | None = None
    google_search: AppFeaturePayload | None = None
    web_reader: AppFeaturePayload | None = None
    wikipedia: AppFeaturePayload | None = None
    current_datetime: AppFeaturePayload | None = None


class AppAgentModePayload(AppExtensibleConfigPayload):
    enabled: bool | None = None
    strategy: str | None = None
    max_iteration: int | None = None
    tools: list[AppAgentToolPayload] | None = None
    prompt: AppAgentPromptPayload | str | None = None


class AppImageUploadPayload(AppExtensibleConfigPayload):
    enabled: bool | None = None
    number_limits: int | None = None
    detail: Literal["low", "high"] | None = None
    transfer_methods: list[FileTransferMethod] | None = None


class AppFileTypeUploadPayload(AppExtensibleConfigPayload):
    enabled: bool | None = None
    number_limits: int | None = None
    transfer_methods: list[FileTransferMethod] | None = None


class AppFilePreviewPayload(AppExtensibleConfigPayload):
    mode: str | None = None
    file_type_list: list[str] | None = None


class AppFileUploadPayload(AppExtensibleConfigPayload):
    enabled: bool | None = None
    image: AppImageUploadPayload | None = None
    image_config: AppImageUploadPayload | None = None
    document: AppFileTypeUploadPayload | None = None
    audio: AppFileTypeUploadPayload | None = None
    video: AppFileTypeUploadPayload | None = None
    custom: AppFileTypeUploadPayload | None = None
    preview_config: AppFilePreviewPayload | None = None
    allowed_file_types: list[FileType] | None = None
    allowed_file_extensions: list[str] | None = None
    allowed_file_upload_methods: list[FileTransferMethod] | None = None
    number_limits: int | None = None


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
