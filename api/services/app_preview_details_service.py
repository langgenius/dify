"""Detached app and workflow details for an already admitted preview."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from pydantic import JsonValue

from services.app_preview_query_service import AppPreviewRef

type AppPreviewModelConfig = Mapping[str, JsonValue | datetime]
type AppPreviewObject = Mapping[str, JsonValue]


@dataclass(frozen=True, slots=True)
class AppPreviewAudit:
    id: str
    created_by: str | None
    created_at: datetime | None
    updated_by: str | None
    updated_at: datetime | None


@dataclass(frozen=True, slots=True)
class AppPreviewTag:
    id: str
    name: str
    type: str


@dataclass(frozen=True, slots=True)
class AppPreviewDeletedTool:
    type: str
    tool_name: str
    provider_id: str


@dataclass(frozen=True, slots=True)
class AppPreviewDetailSite:
    code: str | None
    title: str
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    description: str | None
    default_language: str
    chat_color_theme: str | None
    chat_color_theme_inverted: bool | None
    customize_domain: str | None
    copyright: str | None
    privacy_policy: str | None
    input_placeholder: str | None
    custom_disclaimer: str | None
    customize_token_strategy: str | None
    prompt_public: bool | None
    show_workflow_steps: bool | None
    use_icon_as_answer_icon: bool | None
    created_by: str | None
    created_at: datetime | None
    updated_by: str | None
    updated_at: datetime | None


@dataclass(frozen=True, slots=True)
class AppPreviewDetail:
    id: str
    name: str
    description: str | None
    mode: str
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    enable_site: bool
    enable_api: bool
    model_config: AppPreviewModelConfig | None
    workflow: AppPreviewAudit | None
    use_icon_as_answer_icon: bool | None
    max_active_requests: int | None
    created_by: str | None
    created_at: datetime | None
    updated_by: str | None
    updated_at: datetime | None
    deleted_tools: tuple[AppPreviewDeletedTool, ...]
    tags: tuple[AppPreviewTag, ...]
    site: AppPreviewDetailSite


@dataclass(frozen=True, slots=True)
class AppPreviewDetailRecord:
    """Stored detail values and owner-scoped API providers before tool enrichment."""

    detail: AppPreviewDetail
    existing_api_provider_ids: frozenset[str]


@dataclass(frozen=True, slots=True)
class AppPreviewAccount:
    id: str
    name: str | None
    email: str | None


@dataclass(frozen=True, slots=True)
class AppPreviewWorkflow:
    id: str
    graph: AppPreviewObject
    features: AppPreviewObject
    hash: str | None
    version: str | None
    marked_name: str | None
    marked_comment: str | None
    created_by: AppPreviewAccount | None
    created_at: datetime | None
    updated_by: AppPreviewAccount | None
    updated_at: datetime | None
    tool_published: bool
    environment_variables: tuple[AppPreviewObject, ...]
    conversation_variables: tuple[AppPreviewObject, ...]
    rag_pipeline_variables: tuple[AppPreviewObject, ...]


@dataclass(frozen=True, slots=True)
class AppPreviewWorkflowRecord:
    """Workflow data with environment variables still in their stored, encrypted form."""

    workflow: AppPreviewWorkflow
    tenant_id: str
    environment_variables_json: str | None


class AppPreviewDetailsQuery(Protocol):
    def get_detail(self, *, app: AppPreviewRef, account_id: str) -> AppPreviewDetailRecord: ...

    def get_workflow(self, *, app: AppPreviewRef) -> AppPreviewWorkflowRecord: ...


class AppPreviewDetails(Protocol):
    def get_detail(self, *, app: AppPreviewRef, account_id: str, active_workspace_id: str) -> AppPreviewDetail: ...

    def get_workflow(self, *, app: AppPreviewRef) -> AppPreviewWorkflow: ...
