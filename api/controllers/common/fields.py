from __future__ import annotations

from typing import Any, TypeAlias

from pydantic import BaseModel, ConfigDict, computed_field

from core.file import helpers as file_helpers
from models.model import IconType

JSONValue: TypeAlias = str | int | float | bool | None | dict[str, Any] | list[Any]
JSONObject: TypeAlias = dict[str, Any]


class SystemParameters(BaseModel):
    image_file_size_limit: int
    video_file_size_limit: int
    audio_file_size_limit: int
    file_size_limit: int
    workflow_file_upload_limit: int


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
