from __future__ import annotations

import json
from datetime import datetime
from typing import Any, TypeAlias

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, computed_field, field_validator

from core.file import helpers as file_helpers
from models.model import IconType

JSONValue: TypeAlias = Any


class ResponseModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="ignore",
        populate_by_name=True,
        serialize_by_alias=True,
        protected_namespaces=(),
    )


def _to_timestamp(value: datetime | int | None) -> int | None:
    if isinstance(value, datetime):
        return int(value.timestamp())
    return value


def _build_icon_url(icon_type: str | IconType | None, icon: str | None) -> str | None:
    if icon is None or icon_type is None:
        return None
    icon_type_value = icon_type if isinstance(icon_type, IconType) else str(icon_type)
    if icon_type_value.lower() != IconType.IMAGE:
        return None
    return file_helpers.get_signed_file_url(icon)


class Tag(ResponseModel):
    id: str
    name: str
    type: str


class WorkflowPartial(ResponseModel):
    id: str
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class ModelConfigPartial(ResponseModel):
    model: JSONValue | None = Field(default=None, validation_alias=AliasChoices("model_dict", "model"))
    pre_prompt: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class ModelConfig(ResponseModel):
    opening_statement: str | None = None
    suggested_questions: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("suggested_questions_list", "suggested_questions")
    )
    suggested_questions_after_answer: JSONValue | None = Field(
        default=None,
        validation_alias=AliasChoices("suggested_questions_after_answer_dict", "suggested_questions_after_answer"),
    )
    speech_to_text: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("speech_to_text_dict", "speech_to_text")
    )
    text_to_speech: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("text_to_speech_dict", "text_to_speech")
    )
    retriever_resource: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("retriever_resource_dict", "retriever_resource")
    )
    annotation_reply: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("annotation_reply_dict", "annotation_reply")
    )
    more_like_this: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("more_like_this_dict", "more_like_this")
    )
    sensitive_word_avoidance: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("sensitive_word_avoidance_dict", "sensitive_word_avoidance")
    )
    external_data_tools: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("external_data_tools_list", "external_data_tools")
    )
    model: JSONValue | None = Field(default=None, validation_alias=AliasChoices("model_dict", "model"))
    user_input_form: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("user_input_form_list", "user_input_form")
    )
    dataset_query_variable: str | None = None
    pre_prompt: str | None = None
    agent_mode: JSONValue | None = Field(default=None, validation_alias=AliasChoices("agent_mode_dict", "agent_mode"))
    prompt_type: str | None = None
    chat_prompt_config: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("chat_prompt_config_dict", "chat_prompt_config")
    )
    completion_prompt_config: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("completion_prompt_config_dict", "completion_prompt_config")
    )
    dataset_configs: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("dataset_configs_dict", "dataset_configs")
    )
    file_upload: JSONValue | None = Field(
        default=None, validation_alias=AliasChoices("file_upload_dict", "file_upload")
    )
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class AppDetailKernel(ResponseModel):
    id: str
    name: str
    description: str | None = None
    mode: str = Field(validation_alias="mode_compatible_with_agent")
    icon_type: str | IconType | None = None
    icon: str | None = None
    icon_background: str | None = None

    @computed_field(return_type=str | None)  # type: ignore[misc]
    @property
    def icon_url(self) -> str | None:
        return _build_icon_url(self.icon_type, self.icon)

    @field_validator("icon_type", mode="before")
    @classmethod
    def _normalize_icon_type(cls, value: str | IconType | None) -> str | IconType | None:
        if isinstance(value, IconType):
            return value
        return value


class RelatedAppList(ResponseModel):
    data: list[AppDetailKernel]
    total: int


class Site(ResponseModel):
    access_token: str | None = Field(default=None, validation_alias="code")
    code: str | None = None
    title: str | None = None
    icon_type: str | IconType | None = None
    icon: str | None = None
    icon_background: str | None = None
    description: str | None = None
    default_language: str | None = None
    chat_color_theme: str | None = None
    chat_color_theme_inverted: bool | None = None
    customize_domain: str | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    custom_disclaimer: str | None = None
    customize_token_strategy: str | None = None
    prompt_public: bool | None = None
    app_base_url: str | None = None
    show_workflow_steps: bool | None = None
    use_icon_as_answer_icon: bool | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @computed_field(return_type=str | None)  # type: ignore[misc]
    @property
    def icon_url(self) -> str | None:
        return _build_icon_url(self.icon_type, self.icon)

    @field_validator("icon_type", mode="before")
    @classmethod
    def _normalize_icon_type(cls, value: str | IconType | None) -> str | None:
        if isinstance(value, IconType):
            return value
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class AppSiteModel(Site):
    app_id: str | None = None


class DeletedTool(ResponseModel):
    type: str
    tool_name: str
    provider_id: str


class AppPartial(ResponseModel):
    id: str
    name: str
    max_active_requests: int | None = None
    description: str | None = Field(default=None, validation_alias=AliasChoices("desc_or_prompt", "description"))
    mode: str = Field(validation_alias="mode_compatible_with_agent")
    icon_type: str | IconType | None = None
    icon: str | None = None
    icon_background: str | None = None
    model_config_: ModelConfigPartial | None = Field(
        default=None,
        validation_alias=AliasChoices("app_model_config", "model_config"),
        alias="model_config",
    )
    workflow: WorkflowPartial | None = None
    use_icon_as_answer_icon: bool | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None
    tags: list[Tag] = Field(default_factory=list)
    access_mode: str | None = None
    create_user_name: str | None = None
    author_name: str | None = None
    has_draft_trigger: bool | None = None

    @computed_field(return_type=str | None)  # type: ignore[misc]
    @property
    def icon_url(self) -> str | None:
        return _build_icon_url(self.icon_type, self.icon)

    @field_validator("icon_type", mode="before")
    @classmethod
    def _normalize_icon_type(cls, value: str | IconType | None) -> str | None:
        if isinstance(value, IconType):
            return value
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class AppDetail(ResponseModel):
    id: str
    name: str
    description: str | None = None
    mode: str = Field(validation_alias="mode_compatible_with_agent")
    icon_type: str | IconType | None = None
    icon: str | None = None
    icon_background: str | None = None
    enable_site: bool
    enable_api: bool
    model_config_: ModelConfig | None = Field(
        default=None,
        validation_alias=AliasChoices("app_model_config", "model_config"),
        alias="model_config",
    )
    workflow: WorkflowPartial | None = None
    tracing: JSONValue | None = None
    use_icon_as_answer_icon: bool | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None
    access_mode: str | None = None
    tags: list[Tag] = Field(default_factory=list)

    @computed_field(return_type=str | None)  # type: ignore[misc]
    @property
    def icon_url(self) -> str | None:
        return _build_icon_url(self.icon_type, self.icon)

    @field_validator("icon_type", mode="before")
    @classmethod
    def _normalize_icon_type(cls, value: str | IconType | None) -> str | None:
        if isinstance(value, IconType):
            return value
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class AppDetailWithSite(AppDetail):
    api_base_url: str | None = None
    max_active_requests: int | None = None
    deleted_tools: list[DeletedTool] = Field(default_factory=list)
    site: Site | None = None


class AppPagination(ResponseModel):
    page: int
    limit: int = Field(validation_alias=AliasChoices("per_page", "limit"))
    total: int
    has_more: bool = Field(validation_alias=AliasChoices("has_next", "has_more"))
    data: list[AppPartial] = Field(validation_alias=AliasChoices("items", "data"))


class AppExportResponse(ResponseModel):
    data: str


class LeakedDependency(ResponseModel):
    type: str
    value: JSONValue
    current_identifier: str | None = None


class AppImport(ResponseModel):
    id: str
    status: str
    app_id: str | None = None
    app_mode: str | None = None
    current_dsl_version: str | None = None
    imported_dsl_version: str | None = None
    error: str | None = None


class AppImportCheckDependencies(ResponseModel):
    leaked_dependencies: list[LeakedDependency] = Field(default_factory=list)


class AppServer(ResponseModel):
    id: str
    name: str
    server_code: str
    description: str | None = None
    status: str
    parameters: JSONValue | None = None
    created_at: int | None = None
    updated_at: int | None = None

    @field_validator("parameters", mode="before")
    @classmethod
    def _parse_parameters(cls, value: Any) -> Any:
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


__all__ = [
    "AppDetail",
    "AppDetailKernel",
    "AppDetailWithSite",
    "AppExportResponse",
    "AppImport",
    "AppImportCheckDependencies",
    "AppPagination",
    "AppPartial",
    "AppServer",
    "AppSiteModel",
    "DeletedTool",
    "LeakedDependency",
    "ModelConfig",
    "ModelConfigPartial",
    "RelatedAppList",
    "ResponseModel",
    "Site",
    "Tag",
    "WorkflowPartial",
]
