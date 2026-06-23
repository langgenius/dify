from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, computed_field

from fields.base import ResponseModel
from graphon.file import helpers as file_helpers
from models.model import IconType

type JSONObject = dict[str, Any]


class SystemParameters(BaseModel):
    image_file_size_limit: int
    video_file_size_limit: int
    audio_file_size_limit: int
    file_size_limit: int
    workflow_file_upload_limit: int


class SimpleResultResponse(ResponseModel):
    result: str


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
    text: str


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


class IndexInfoResponse(ResponseModel):
    welcome: str
    api_version: str
    server_version: str


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
    suggested_questions_after_answer: JSONObject
    speech_to_text: JSONObject
    text_to_speech: JSONObject
    retriever_resource: JSONObject
    annotation_reply: JSONObject
    more_like_this: JSONObject
    user_input_form: list[JSONObject]
    sensitive_word_avoidance: JSONObject
    file_upload: JSONObject
    system_parameters: SystemParameters


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
    custom_disclaimer: str | None = None
    default_language: str
    show_workflow_steps: bool
    use_icon_as_answer_icon: bool

    @computed_field(return_type=str | None)  # type: ignore
    @property
    def icon_url(self) -> str | None:
        if self.icon and self.icon_type == IconType.IMAGE:
            return file_helpers.get_signed_file_url(self.icon)
        return None
