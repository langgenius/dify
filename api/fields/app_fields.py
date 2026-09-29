"""Shared Console app response schemas for materialized application results."""

from datetime import datetime

from pydantic import AliasChoices, Field, computed_field, field_validator

from enums import WebAppAccessMode
from fields.app_model_config_response import AppModelConfigResponse, AppModelSelectionResponse
from fields.base import ResponseModel
from libs.helper import build_icon_url, to_timestamp
from models.enums import CustomizeTokenStrategy
from models.model import AppMode, IconType
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
    model: AppModelSelectionResponse | None = Field(default=None, validation_alias=AliasChoices("model_dict", "model"))
    pre_prompt: str | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AppDetailSiteResponse(ResponseModel):
    access_token: str | None = Field(validation_alias="code")
    code: str | None
    title: str
    icon_type: IconType | None
    icon: str | None
    icon_background: str | None
    description: str | None
    default_language: str
    chat_color_theme: str | None
    chat_color_theme_inverted: bool
    customize_domain: str | None
    copyright: str | None
    privacy_policy: str | None
    input_placeholder: str | None
    custom_disclaimer: str
    customize_token_strategy: CustomizeTokenStrategy
    prompt_public: bool
    app_base_url: str
    show_workflow_steps: bool
    use_icon_as_answer_icon: bool
    created_by: str | None
    created_at: int
    updated_by: str | None
    updated_at: int

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
    mode: AppMode = Field(validation_alias="mode_compatible_with_agent")
    icon_type: IconType | None = None
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
    access_mode: WebAppAccessMode | None = None
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
    description: str
    mode: AppMode = Field(validation_alias="mode_compatible_with_agent")
    icon: str | None
    icon_background: str | None
    enable_site: bool
    enable_api: bool
    model_config_: AppModelConfigResponse | None = Field(
        validation_alias=AliasChoices("app_model_config", "model_config"),
        alias="model_config",
    )
    workflow: WorkflowPartial | None
    tracing: str | None
    use_icon_as_answer_icon: bool
    created_by: str | None
    created_at: int
    updated_by: str | None
    updated_at: int
    access_mode: WebAppAccessMode | None
    tags: list[Tag]
    permission_keys: list[str]
    maintainer: str | None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AppDetailWithSite(AppDetail):
    icon_type: IconType | None
    api_base_url: str
    max_active_requests: int | None
    deleted_tools: list[DeletedTool]
    site: AppDetailSiteResponse | None
    # For Agent App type: the roster Agent backing this app (None otherwise).
    bound_agent_id: str | None
    # For Agent App responses exposed through /agent.
    app_id: str | None

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
    app_mode: AppMode | None = None
    current_dsl_version: str
    imported_dsl_version: str = ""
    error: str = ""
    warnings: list[DslImportWarning] = Field(default_factory=list)
