from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, WithJsonSchema, computed_field

from fields.base import ResponseModel
from fields.types import (
    DecimalString,
    DoubleNumber,
    FloatNumber,
    Int64,
    JSONObject,
    ShallowJSONValue,
    URLString,
    UUIDString,
)
from fields.workflow_fields import (
    PauseReasonResponseBase,
    WorkflowBlockingResponse,  # noqa: F401 - shared response contract export
)
from graphon.file import helpers as file_helpers
from models.model import IconType

FeatureToggleObject = Annotated[
    JSONObject,
    WithJsonSchema({"type": "object", "properties": {"enabled": {"type": "boolean"}}}),
]
TextToSpeechObject = Annotated[
    JSONObject,
    WithJsonSchema(
        {
            "type": "object",
            "properties": {
                "enabled": {"type": "boolean"},
                "voice": {"type": "string"},
                "language": {"type": "string"},
                "autoPlay": {"type": "string"},
            },
        }
    ),
]
FileUploadObject = Annotated[
    JSONObject,
    WithJsonSchema(
        {
            "type": "object",
            "properties": {
                "enabled": {"type": "boolean"},
                "number_limits": {"type": "integer"},
                "allowed_file_types": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["document", "image", "audio", "video", "custom"],
                    },
                },
                "allowed_file_extensions": {"type": "array", "items": {"type": "string"}},
                "allowed_file_upload_methods": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["remote_url", "local_file"],
                    },
                },
                "image": {
                    "type": "object",
                    "properties": {
                        "enabled": {"type": "boolean"},
                        "number_limits": {"type": "integer"},
                        "detail": {"type": "string"},
                        "transfer_methods": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
        }
    ),
]
USER_INPUT_FORM_TYPES = (
    "text-input",
    "select",
    "paragraph",
    "number",
    "external_data_tool",
    "file",
    "file-list",
    "checkbox",
    "json_object",
)
USER_INPUT_FORM_ITEM_CONFIG_SCHEMA: dict[str, object] = {
    "type": "object",
    "required": ["label", "variable"],
    "properties": {
        "variable": {"type": "string"},
        "label": {"type": "string"},
        "description": {"type": "string"},
        "required": {"type": "boolean"},
        "hide": {"type": "boolean"},
        # Defaults are typed by the form kind: strings, numbers, booleans,
        # JSON objects, and file references are all valid public values.
        "default": {},
        "type": {"enum": list(USER_INPUT_FORM_TYPES), "type": "string"},
        "max_length": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
        "options": {"type": "array", "items": {"type": "string"}},
        "allowed_file_types": {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}]},
        "allowed_file_extensions": {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}]},
        "allowed_file_upload_methods": {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}]},
        "json_schema": {
            "anyOf": [
                {"type": "object", "additionalProperties": True},
                {"type": "null"},
            ]
        },
        "config": {"type": "object", "additionalProperties": True},
    },
}
UserInputFormList = Annotated[
    list[JSONObject],
    WithJsonSchema(
        {
            "type": "array",
            "items": {
                "type": "object",
                "oneOf": [
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {form_type: USER_INPUT_FORM_ITEM_CONFIG_SCHEMA},
                        "required": [form_type],
                    }
                    for form_type in USER_INPUT_FORM_TYPES
                ],
            },
        }
    ),
]


class SystemParameters(BaseModel):
    image_file_size_limit: int
    video_file_size_limit: int
    audio_file_size_limit: int
    file_size_limit: int
    workflow_file_upload_limit: int


class BlockingUsageResponse(ResponseModel):
    model_config = ConfigDict(extra="allow")

    prompt_tokens: int | None = None
    prompt_unit_price: DecimalString | None = None
    prompt_price_unit: DecimalString | None = None
    prompt_price: DecimalString | None = None
    completion_tokens: int | None = None
    completion_unit_price: DecimalString | None = None
    completion_price_unit: DecimalString | None = None
    completion_price: DecimalString | None = None
    total_tokens: int | None = None
    total_price: DecimalString | None = None
    currency: str | None = None
    latency: DoubleNumber | None = None


class BlockingRetrieverResourceResponse(ResponseModel):
    model_config = ConfigDict(extra="allow")

    id: UUIDString | None = None
    message_id: UUIDString | None = None
    position: int
    dataset_id: UUIDString | None = None
    dataset_name: str | None = None
    document_id: UUIDString | None = None
    document_name: str | None = None
    data_source_type: str | None = None
    segment_id: UUIDString | None = None
    score: FloatNumber | None = None
    hit_count: int | None = None
    word_count: int | None = None
    segment_position: int | None = None
    index_node_hash: str | None = None
    content: str | None = None
    summary: str | None = None
    created_at: Int64 | None = None


class BlockingMetadataResponse(ResponseModel):
    model_config = ConfigDict(extra="allow")

    usage: BlockingUsageResponse | None = None
    retriever_resources: list[BlockingRetrieverResourceResponse] | None = None


class ChatMessageBlockingResponse(ResponseModel):
    model_config = ConfigDict(extra="allow")

    event: Literal["message"]
    task_id: UUIDString
    id: UUIDString
    message_id: UUIDString
    conversation_id: UUIDString
    mode: str
    answer: str
    metadata: BlockingMetadataResponse = Field(description="Metadata including usage and retriever resources.")
    created_at: Int64


class ChatPauseReasonResponse(PauseReasonResponseBase):
    """Public pause reason emitted by a blocking Chatflow execution."""

    TYPE: str


class ChatPausedBlockingDataResponse(ResponseModel):
    model_config = ConfigDict(extra="allow")

    id: UUIDString
    mode: str
    conversation_id: UUIDString
    message_id: UUIDString
    workflow_run_id: UUIDString
    answer: str
    metadata: BlockingMetadataResponse = Field(description="Metadata including usage and retriever resources.")
    created_at: Int64
    paused_nodes: list[str]
    reasons: list[ChatPauseReasonResponse]
    status: Literal["paused"]
    elapsed_time: FloatNumber
    total_tokens: int
    total_steps: int


class ChatPausedBlockingResponse(ResponseModel):
    model_config = ConfigDict(extra="allow")

    event: Literal["workflow_paused"]
    task_id: UUIDString
    id: UUIDString
    message_id: UUIDString
    conversation_id: UUIDString
    mode: str
    answer: str
    metadata: BlockingMetadataResponse = Field(description="Metadata including usage and retriever resources.")
    created_at: Int64
    workflow_run_id: UUIDString
    data: ChatPausedBlockingDataResponse


class ChatBlockingResponse(
    RootModel[
        Annotated[
            ChatMessageBlockingResponse | ChatPausedBlockingResponse,
            Field(discriminator="event"),
        ]
    ]
):
    """Blocking chat response for a completed message or paused Chatflow."""


class CompletionBlockingResponse(ResponseModel):
    model_config = ConfigDict(extra="allow")

    event: str
    task_id: UUIDString
    id: UUIDString
    message_id: UUIDString
    mode: str
    answer: str
    metadata: BlockingMetadataResponse = Field(description="Metadata including usage and retriever resources.")
    created_at: Int64


class SimpleResultResponse(ResponseModel):
    result: str = Field(description="Operation result.")


class GeneratedAppResponse(RootModel[ShallowJSONValue]):
    root: ShallowJSONValue


class EventStreamResponse(RootModel[str]):
    root: str


class TextFileResponse(RootModel[str]):
    root: str


class RedirectResponse(RootModel[str]):
    root: str


class BinaryFileResponse(RootModel[bytes]):
    root: bytes


class AudioBinaryResponse(RootModel[bytes]):
    root: bytes


class AudioTranscriptResponse(ResponseModel):
    text: str = Field(description="Transcribed text from audio")


class ValidationResultResponse(ResponseModel):
    result: Literal["success", "error"]
    error: str | None = None


class SimpleResultMessageResponse(ResponseModel):
    result: str
    message: str


class SimpleMessageResponse(ResponseModel):
    message: str


class SimpleDataResponse(ResponseModel):
    data: str


class SimpleResultDataResponse(ResponseModel):
    result: str
    data: str


class SimpleResultStringListResponse(ResponseModel):
    result: str
    data: list[str]


class SimpleResultOptionalDataResponse(ResponseModel):
    result: str
    data: str | None = None


class AccessTokenData(ResponseModel):
    access_token: str


class AccessTokenResultResponse(ResponseModel):
    result: str
    data: AccessTokenData


class VerificationTokenResponse(ResponseModel):
    is_valid: bool
    email: str
    token: str


class LoginStatusResponse(ResponseModel):
    logged_in: bool
    app_logged_in: bool


class AccessModeResponse(ResponseModel):
    access_mode: str = Field(serialization_alias="accessMode", validation_alias="accessMode")


class BooleanResultResponse(ResponseModel):
    result: bool


class SuccessResponse(ResponseModel):
    success: bool


class UsageCheckResponse(ResponseModel):
    is_using: bool


class UsageCountResponse(ResponseModel):
    is_using: bool
    count: int


class AvatarUrlResponse(ResponseModel):
    avatar_url: str


class TextContentResponse(ResponseModel):
    content: str


class AllowedExtensionsResponse(ResponseModel):
    allowed_extensions: list[str]


class UrlResponse(ResponseModel):
    url: str


class RedirectUrlResponse(ResponseModel):
    redirect_url: str


class ApiBaseUrlResponse(ResponseModel):
    api_base_url: str


class NewAppResponse(ResponseModel):
    new_app_id: str
    permission_keys: list[str] = Field(default_factory=list)


class Parameters(BaseModel):
    opening_statement: str | None = None
    suggested_questions: list[str]
    suggested_questions_after_answer: FeatureToggleObject
    speech_to_text: FeatureToggleObject
    text_to_speech: TextToSpeechObject
    retriever_resource: FeatureToggleObject
    annotation_reply: FeatureToggleObject
    more_like_this: FeatureToggleObject
    user_input_form: UserInputFormList
    sensitive_word_avoidance: FeatureToggleObject
    file_upload: FileUploadObject
    system_parameters: SystemParameters = Field(description="System-level parameter limits.")


class Site(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    title: str
    chat_color_theme: str | None = None
    chat_color_theme_inverted: bool
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    description: str | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    input_placeholder: str | None = None
    custom_disclaimer: str | None = None
    default_language: str
    show_workflow_steps: bool
    use_icon_as_answer_icon: bool

    @computed_field(return_type=URLString | None)  # type: ignore
    @property
    def icon_url(self) -> str | None:
        if self.icon and self.icon_type == IconType.IMAGE:
            return file_helpers.get_signed_file_url(self.icon)
        return None


class ErrorMessageResponse(ResponseModel):
    """Legacy ``{"error": message}`` body a few endpoints return instead of the standard error body."""

    error: str
