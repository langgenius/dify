"""Shared application contracts, independent of service implementations."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, NotRequired, TypedDict
from uuid import UUID

from pydantic import BaseModel, Field

from models.model import AppMode, IconType
from services.entities.dsl_entities import DslImportWarning

AppListSortBy = Literal["last_modified", "recently_created", "earliest_created"]
RecentAppMode = Literal[
    AppMode.COMPLETION,
    AppMode.WORKFLOW,
    AppMode.CHAT,
    AppMode.ADVANCED_CHAT,
    AppMode.AGENT_CHAT,
]
RECENT_APP_MODES: tuple[RecentAppMode, ...] = (
    AppMode.COMPLETION,
    AppMode.WORKFLOW,
    AppMode.CHAT,
    AppMode.ADVANCED_CHAT,
    AppMode.AGENT_CHAT,
)


class AppListBaseParams(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)
    mode: Literal["completion", "chat", "advanced-chat", "workflow", "agent-chat", "agent", "channel", "all"] = "all"
    sort_by: AppListSortBy = "last_modified"
    name: str | None = None
    tag_ids: list[str] | None = None
    creator_ids: list[str] | None = None
    is_created_by_me: bool | None = None
    accessible_app_ids: list[str] | None = None
    include_own_apps: bool = False


class AppListParams(AppListBaseParams):
    status: str | None = None
    openapi_visible: bool = False
    agent_is_published: bool | None = None


class StarredAppListParams(AppListBaseParams):
    pass


@dataclass(frozen=True)
class AgentAppPublicationCounts:
    published: int
    drafts: int


@dataclass(frozen=True, slots=True)
class AppSummary:
    id: str
    tenant_id: str
    name: str
    description: str
    mode: AppMode
    status: str
    updated_at: datetime | None
    maintainer: str | None


@dataclass(frozen=True)
class RecentAppListItem:
    id: str
    name: str
    icon_type: IconType | None
    icon: str | None
    icon_background: str | None
    mode: RecentAppMode
    author_name: str | None
    updated_at: datetime
    maintainer: str | None
    permission_keys: list[str] = field(default_factory=list)


class CreateAppParams(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    mode: Literal["chat", "agent-chat", "agent", "advanced-chat", "workflow", "completion"]
    agent_role: str = Field(default="", max_length=255)
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    api_rph: int = 0
    api_rpm: int = 0
    max_active_requests: int | None = None


@dataclass(frozen=True, slots=True)
class AppToolReference:
    provider_type: str
    provider_id: str
    tool_name: str
    # API providers are resolved in the repository; builtin providers are resolved by the gateway.
    exists: bool | None = None


@dataclass(frozen=True, slots=True)
class AppRecord:
    """Fully materialized app data; no ORM instances or deferred reads."""

    id: str
    name: str
    mode_compatible_with_agent: str
    description: str | None = None
    desc_or_prompt: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    enable_site: bool = False
    enable_api: bool = False
    max_active_requests: int | None = None
    use_icon_as_answer_icon: bool = False
    created_by: str | None = None
    created_at: datetime | None = None
    updated_by: str | None = None
    updated_at: datetime | None = None
    maintainer: str | None = None
    author_name: str | None = None
    app_model_config: dict[str, Any] | None = None
    workflow: dict[str, Any] | None = None
    site: dict[str, Any] | None = None
    tracing: str | None = None
    bound_agent_id: str | None = None
    tags: list[dict[str, str]] = field(default_factory=list)
    deleted_tools: list[dict[str, str]] = field(default_factory=list)
    tool_references: tuple[AppToolReference, ...] = ()
    access_mode: str | None = None
    permission_keys: list[str] = field(default_factory=list)
    has_draft_trigger: bool | None = None
    is_starred: bool = False


@dataclass(frozen=True, slots=True)
class AppPage:
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[AppRecord]


class UpdateAppParams(BaseModel):
    role: str | None = None
    name: str
    description: str = ""
    icon_type: IconType | None = None
    icon: str = ""
    icon_background: str = ""
    use_icon_as_answer_icon: bool = False
    max_active_requests: int = 0


class CopyAppParams(BaseModel):
    name: str | None = None
    description: str | None = None
    icon_type: IconType | None = None
    icon: str | None = None
    icon_background: str | None = None


@dataclass(frozen=True, slots=True)
class AppExportOptions:
    format: Literal["yaml", "ifpkg"] | None = None
    include_secret: bool = False
    workflow_id: str | None = None
    version_id: UUID | None = None


@dataclass(frozen=True, slots=True)
class AppReference:
    id: str
    name: str
    mode: str
    bound_agent_id: str | None


@dataclass(frozen=True, slots=True)
class AppTraceSettings:
    enabled: bool = False
    tracing_provider: str | None = None


@dataclass(frozen=True, slots=True)
class AppCreationSettings:
    app: dict[str, Any]
    model_config: dict[str, Any] | None


@dataclass(frozen=True, slots=True)
class AppEvent:
    id: str
    tenant_id: str
    mode: str


@dataclass(frozen=True, slots=True)
class AppDeletion:
    app: AppEvent
    workflow_agent_ids: set[str]
    workspace_ids: list[str]
    binding_ids: list[str]
    home_snapshot_ids: list[str]
    backing_agent_id: str | None


@dataclass(frozen=True, slots=True)
class AppChange:
    app: AppRecord
    changed: bool


class AppUpdateArguments(TypedDict):
    name: str
    description: str
    icon_type: IconType | str | None
    icon: str
    icon_background: str
    use_icon_as_answer_icon: bool
    max_active_requests: int
    role: NotRequired[str | None]


@dataclass(frozen=True, slots=True)
class ImportedAppPackage:
    app_id: str
    agent_id: str
    warnings: list[DslImportWarning]
