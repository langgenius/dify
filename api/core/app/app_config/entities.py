from collections.abc import Sequence
from enum import StrEnum, auto
from typing import Any, Literal

from jsonschema import Draft7Validator, SchemaError
from pydantic import BaseModel, Field, field_validator

from core.file import FileTransferMethod, FileType, FileUploadConfig
from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.message_entities import PromptMessageRole
from models.model import AppMode


class ModelConfigEntity(BaseModel):
    """
    Model Config Entity.
    """

    provider: str
    model: str
    mode: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    stop: list[str] = Field(default_factory=list)


class AdvancedChatMessageEntity(BaseModel):
    """
    Advanced Chat Message Entity.
    """

    text: str
    role: PromptMessageRole


class AdvancedChatPromptTemplateEntity(BaseModel):
    """
    Advanced Chat Prompt Template Entity.
    """

    messages: list[AdvancedChatMessageEntity]


class AdvancedCompletionPromptTemplateEntity(BaseModel):
    """
    Advanced Completion Prompt Template Entity.
    """

    class RolePrefixEntity(BaseModel):
        """
        Role Prefix Entity.
        """

        user: str
        assistant: str

    prompt: str
    role_prefix: RolePrefixEntity | None = None


class PromptTemplateEntity(BaseModel):
    """
    Prompt Template Entity.
    """

    class PromptType(StrEnum):
        """
        Prompt Type.
        'simple', 'advanced'
        """

        SIMPLE = auto()
        ADVANCED = auto()

        @classmethod
        def value_of(cls, value: str):
            """
            Get value of given mode.

            :param value: mode value
            :return: mode
            """
            for mode in cls:
                if mode.value == value:
                    return mode
            raise ValueError(f"invalid prompt type value {value}")

    prompt_type: PromptType
    simple_prompt_template: str | None = None
    advanced_chat_prompt_template: AdvancedChatPromptTemplateEntity | None = None
    advanced_completion_prompt_template: AdvancedCompletionPromptTemplateEntity | None = None


class VariableEntityType(StrEnum):
    TEXT_INPUT = "text-input"
    SELECT = "select"
    PARAGRAPH = "paragraph"
    NUMBER = "number"
    EXTERNAL_DATA_TOOL = "external_data_tool"
    FILE = "file"
    FILE_LIST = "file-list"
    CHECKBOX = "checkbox"
    JSON_OBJECT = "json_object"


class VariableEntity(BaseModel):
    """
    Variable Entity.
    """

    # `variable` records the name of the variable in user inputs.
    variable: str
    label: str
    description: str = ""
    type: VariableEntityType
    required: bool = False
    hide: bool = False
    default: Any = None
    max_length: int | None = None
    options: Sequence[str] = Field(default_factory=list)
    allowed_file_types: Sequence[FileType] | None = Field(default_factory=list)
    allowed_file_extensions: Sequence[str] | None = Field(default_factory=list)
    allowed_file_upload_methods: Sequence[FileTransferMethod] | None = Field(default_factory=list)
    json_schema: dict[str, Any] | None = Field(default=None)

    @field_validator("description", mode="before")
    @classmethod
    def convert_none_description(cls, v: Any) -> str:
        return v or ""

    @field_validator("options", mode="before")
    @classmethod
    def convert_none_options(cls, v: Any) -> Sequence[str]:
        return v or []

    @field_validator("json_schema")
    @classmethod
    def validate_json_schema(cls, schema: dict[str, Any] | None) -> dict[str, Any] | None:
        if schema is None:
            return None
        try:
            Draft7Validator.check_schema(schema)
        except SchemaError as e:
            raise ValueError(f"Invalid JSON schema: {e.message}")
        return schema


class RagPipelineVariableEntity(VariableEntity):
    """
    Rag Pipeline Variable Entity.
    """

    tooltips: str | None = None
    placeholder: str | None = None
    belong_to_node_id: str


class ExternalDataVariableEntity(BaseModel):
    """
    External Data Variable Entity.
    """

    variable: str
    type: str
    config: dict[str, Any] = Field(default_factory=dict)


SupportedComparisonOperator = Literal[
    # for string or array
    "contains",
    "not contains",
    "start with",
    "end with",
    "is",
    "is not",
    "empty",
    "not empty",
    "in",
    "not in",
    # for number
    "=",
    "≠",
    ">",
    "<",
    "≥",
    "≤",
    # for time
    "before",
    "after",
]


class ModelConfig(BaseModel):
    provider: str
    name: str
    mode: LLMMode
    completion_params: dict[str, Any] = Field(default_factory=dict)


class Condition(BaseModel):
    """
    Condition detail
    """

    name: str
    comparison_operator: SupportedComparisonOperator
    value: str | Sequence[str] | None | int | float = None


class MetadataFilteringCondition(BaseModel):
    """
    Metadata Filtering Condition.
    """

    logical_operator: Literal["and", "or"] | None = "and"
    conditions: list[Condition] | None = Field(default=None, deprecated=True)


class DatasetRetrieveConfigEntity(BaseModel):
    """
    Dataset Retrieve Config Entity.
    """

    class RetrieveStrategy(StrEnum):
        """
        Dataset Retrieve Strategy.
        'single' or 'multiple'
        """

        SINGLE = auto()
        MULTIPLE = auto()

        @classmethod
        def value_of(cls, value: str):
            """
            Get value of given mode.

            :param value: mode value
            :return: mode
            """
            for mode in cls:
                if mode.value == value:
                    return mode
            raise ValueError(f"invalid retrieve strategy value {value}")

    query_variable: str | None = None  # Only when app mode is completion

    retrieve_strategy: RetrieveStrategy
    top_k: int | None = None
    score_threshold: float | None = 0.0
    rerank_mode: str | None = "reranking_model"
    reranking_model: dict | None = None
    weights: dict | None = None
    reranking_enabled: bool | None = True
    metadata_filtering_mode: Literal["disabled", "automatic", "manual"] | None = "disabled"
    metadata_model_config: ModelConfig | None = None
    metadata_filtering_conditions: MetadataFilteringCondition | None = None


class DatasetEntity(BaseModel):
    """
    Dataset Config Entity.
    """

    dataset_ids: list[str]
    retrieve_config: DatasetRetrieveConfigEntity


class SensitiveWordAvoidanceEntity(BaseModel):
    """
    Sensitive Word Avoidance Entity.
    """

    type: str
    config: dict[str, Any] = Field(default_factory=dict)


class TextToSpeechEntity(BaseModel):
    """
    Sensitive Word Avoidance Entity.
    """

    enabled: bool
    voice: str | None = None
    language: str | None = None


class TracingConfigEntity(BaseModel):
    """
    Tracing Config Entity.
    """

    enabled: bool
    tracing_provider: str


class AppAdditionalFeatures(BaseModel):
    file_upload: FileUploadConfig | None = None
    opening_statement: str | None = None
    suggested_questions: list[str] = []
    suggested_questions_after_answer: bool = False
    show_retrieve_source: bool = False
    more_like_this: bool = False
    speech_to_text: bool = False
    text_to_speech: TextToSpeechEntity | None = None
    trace_config: TracingConfigEntity | None = None


class AppConfig(BaseModel):
    """
    Application Config Entity.
    """

    tenant_id: str
    app_id: str
    app_mode: AppMode
    additional_features: AppAdditionalFeatures | None = None
    variables: list[VariableEntity] = []
    sensitive_word_avoidance: SensitiveWordAvoidanceEntity | None = None


class EasyUIBasedAppModelConfigFrom(StrEnum):
    """
    App Model Config From.
    """

    ARGS = auto()
    APP_LATEST_CONFIG = "app-latest-config"
    CONVERSATION_SPECIFIC_CONFIG = "conversation-specific-config"


class EasyUIBasedAppConfig(AppConfig):
    """
    Easy UI Based App Config Entity.
    """

    app_model_config_from: EasyUIBasedAppModelConfigFrom
    app_model_config_id: str
    app_model_config_dict: dict
    model: ModelConfigEntity
    prompt_template: PromptTemplateEntity
    dataset: DatasetEntity | None = None
    external_data_variables: list[ExternalDataVariableEntity] = []


class WorkflowUIBasedAppConfig(AppConfig):
    """
    Workflow UI Based App Config Entity.
    """

    workflow_id: str
