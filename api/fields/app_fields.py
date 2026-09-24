"""Shared Console app response schemas for materialized application results."""

from datetime import datetime
from typing import Any

from pydantic import AliasChoices, Field, computed_field, field_validator

from fields.base import ResponseModel
from libs.helper import build_icon_url, to_timestamp
from models.model import IconType
from services.entities.app_entities import RecentAppMode
from services.entities.dsl_entities import DslImportWarning, ImportStatus


class AppTraceResponse(ResponseModel):
    enabled: bool = False
    tracing_provider: str | None = None


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
        return to_timestamp(value)


class ModelConfigPartial(ResponseModel):
    model: Any | None = Field(default=None, validation_alias=AliasChoices("model_dict", "model"))
    pre_prompt: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AppModelConfigResponse(ResponseModel):
    opening_statement: str | None = None
    suggested_questions: Any | None = Field(
        default=None, validation_alias=AliasChoices("suggested_questions_list", "suggested_questions")
    )
    suggested_questions_after_answer: Any | None = Field(
        default=None,
        validation_alias=AliasChoices("suggested_questions_after_answer_dict", "suggested_questions_after_answer"),
    )
    speech_to_text: Any | None = Field(
        default=None, validation_alias=AliasChoices("speech_to_text_dict", "speech_to_text")
    )
    text_to_speech: Any | None = Field(
        default=None, validation_alias=AliasChoices("text_to_speech_dict", "text_to_speech")
    )
    retriever_resource: Any | None = Field(
        default=None, validation_alias=AliasChoices("retriever_resource_dict", "retriever_resource")
    )
    annotation_reply: Any | None = Field(
        default=None, validation_alias=AliasChoices("annotation_reply_dict", "annotation_reply")
    )
    more_like_this: Any | None = Field(
        default=None, validation_alias=AliasChoices("more_like_this_dict", "more_like_this")
    )
    sensitive_word_avoidance: Any | None = Field(
        default=None, validation_alias=AliasChoices("sensitive_word_avoidance_dict", "sensitive_word_avoidance")
    )
    external_data_tools: Any | None = Field(
        default=None, validation_alias=AliasChoices("external_data_tools_list", "external_data_tools")
    )
    model: Any | None = Field(default=None, validation_alias=AliasChoices("model_dict", "model"))
    user_input_form: Any | None = Field(
        default=None, validation_alias=AliasChoices("user_input_form_list", "user_input_form")
    )
    dataset_query_variable: str | None = None
    pre_prompt: str | None = None
    agent_mode: Any | None = Field(default=None, validation_alias=AliasChoices("agent_mode_dict", "agent_mode"))
    prompt_type: str | None = None
    chat_prompt_config: Any | None = Field(
        default=None, validation_alias=AliasChoices("chat_prompt_config_dict", "chat_prompt_config")
    )
    completion_prompt_config: Any | None = Field(
        default=None, validation_alias=AliasChoices("completion_prompt_config_dict", "completion_prompt_config")
    )
    dataset_configs: Any | None = Field(
        default=None, validation_alias=AliasChoices("dataset_configs_dict", "dataset_configs")
    )
    file_upload: Any | None = Field(default=None, validation_alias=AliasChoices("file_upload_dict", "file_upload"))
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AppDetailSiteResponse(ResponseModel):
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
    input_placeholder: str | None = None
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

    @computed_field(return_type=str | None)  # type: ignore
    @property
    def icon_url(self) -> str | None:
        return build_icon_url(self.icon_type, self.icon)

    @field_validator("icon_type", mode="before")
    @classmethod
    def _normalize_icon_type(cls, value: str | IconType | None) -> str | None:
        if isinstance(value, IconType):
            return value.value
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


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
    icon_type: str | None = None
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
    permission_keys: list[str] = Field(default_factory=list)
    # For Agent App type: the roster Agent backing this app (None otherwise).
    bound_agent_id: str | None = None
    # For Agent App responses exposed through /agent.
    app_id: str | None = None
    is_starred: bool = False
    maintainer: str | None = None

    @computed_field(return_type=str | None)  # type: ignore
    @property
    def icon_url(self) -> str | None:
        return build_icon_url(self.icon_type, self.icon)

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class RecentAppResponse(ResponseModel):
    id: str
    name: str
    icon_type: IconType | None = None
    icon: str | None = None
    icon_background: str | None = None
    mode: RecentAppMode
    author_name: str | None = None
    updated_at: int
    permission_keys: list[str] = Field(default_factory=list)
    maintainer: str | None = None

    @computed_field(return_type=str | None)  # type: ignore[prop-decorator]
    @property
    def icon_url(self) -> str | None:
        return build_icon_url(self.icon_type, self.icon)

    @field_validator("updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int) -> int:
        return to_timestamp(value)


class RecentAppListResponse(ResponseModel):
    data: list[RecentAppResponse]


class AppDetail(ResponseModel):
    id: str
    name: str
    description: str | None = None
    mode: str = Field(validation_alias="mode_compatible_with_agent")
    icon: str | None = None
    icon_background: str | None = None
    enable_site: bool
    enable_api: bool
    model_config_: AppModelConfigResponse | None = Field(
        default=None,
        validation_alias=AliasChoices("app_model_config", "model_config"),
        alias="model_config",
    )
    workflow: WorkflowPartial | None = None
    tracing: Any | None = None
    use_icon_as_answer_icon: bool | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None
    access_mode: str | None = None
    tags: list[Tag] = Field(default_factory=list)
    permission_keys: list[str] = Field(default_factory=list)
    maintainer: str | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AppDetailWithSite(AppDetail):
    icon_type: str | None = None
    api_base_url: str | None = None
    max_active_requests: int | None = None
    deleted_tools: list[DeletedTool] = Field(default_factory=list)
    site: AppDetailSiteResponse | None = None
    # For Agent App type: the roster Agent backing this app (None otherwise).
    bound_agent_id: str | None = None
    # For Agent App responses exposed through /agent.
    app_id: str | None = None

    @computed_field(return_type=str | None)  # type: ignore
    @property
    def icon_url(self) -> str | None:
        return build_icon_url(self.icon_type, self.icon)


class AppPagination(ResponseModel):
    page: int
    limit: int = Field(validation_alias=AliasChoices("per_page", "limit"))
    total: int
    has_more: bool = Field(validation_alias=AliasChoices("has_next", "has_more"))
    data: list[AppPartial] = Field(validation_alias=AliasChoices("items", "data"))


class AppExportResponse(ResponseModel):
    data: str


class AppImportResponse(ResponseModel):
    id: str
    status: ImportStatus
    app_id: str | None = None
    app_mode: str | None = None
    current_dsl_version: str
    imported_dsl_version: str = ""
    error: str = ""
    warnings: list[DslImportWarning] = Field(default_factory=list)
