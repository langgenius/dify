"""Shared response substructures for openapi endpoints."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from libs.helper import UUIDStrOrEmpty, uuid_value
from models.model import AppMode

# Server-side cap on `limit` query param for any /openapi/v1/* list endpoint.
# Sibling endpoints (`/apps`, `/account/sessions`, future routes) all clamp to
# this; do not introduce per-endpoint caps without raising the constant.
MAX_PAGE_LIMIT = 200


class UsageInfo(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class MessageMetadata(BaseModel):
    usage: UsageInfo | None = None
    retriever_resources: list[dict[str, Any]] = []


class PaginationEnvelope[T](BaseModel):
    """Canonical pagination envelope for `/openapi/v1/*` list endpoints."""

    page: int
    limit: int
    total: int
    has_more: bool
    data: list[T]

    @classmethod
    def build(cls, *, page: int, limit: int, total: int, items: list[T]) -> PaginationEnvelope[T]:
        return cls(page=page, limit=limit, total=total, has_more=page * limit < total, data=items)


class TagItem(BaseModel):
    name: str


class AppListRow(BaseModel):
    id: str
    name: str
    description: str | None = None
    mode: AppMode
    tags: list[TagItem] = []
    updated_at: str | None = None
    created_by_name: str | None = None
    workspace_id: str | None = None
    workspace_name: str | None = None


class AppListResponse(BaseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[AppListRow]


class PermittedExternalAppsListResponse(BaseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[AppListRow]


class AppInfoResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    mode: str
    author: str | None = None
    tags: list[TagItem] = []


class AppDescribeInfo(AppInfoResponse):
    updated_at: str | None = None
    service_api_enabled: bool
    is_agent: bool = False


class AppDescribeResponse(BaseModel):
    info: AppDescribeInfo | None = None
    parameters: dict[str, Any] | None = None
    input_schema: dict[str, Any] | None = None


class ChatMessageResponse(BaseModel):
    event: str
    task_id: str
    id: str
    message_id: str
    conversation_id: str
    mode: str
    answer: str
    metadata: MessageMetadata = Field(default_factory=MessageMetadata)
    created_at: int


class CompletionMessageResponse(BaseModel):
    event: str
    task_id: str
    id: str
    message_id: str
    mode: str
    answer: str
    metadata: MessageMetadata = Field(default_factory=MessageMetadata)
    created_at: int


class WorkflowRunData(BaseModel):
    id: str
    workflow_id: str
    status: str
    outputs: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None
    total_steps: int | None = None
    created_at: int | None = None
    finished_at: int | None = None


class WorkflowRunResponse(BaseModel):
    workflow_run_id: str
    task_id: str
    mode: Literal["workflow"] = "workflow"
    data: WorkflowRunData


class AccountPayload(BaseModel):
    id: str
    email: str
    name: str


class WorkspacePayload(BaseModel):
    id: str
    name: str
    role: str


class AccountResponse(BaseModel):
    subject_type: str
    subject_email: str | None = None
    subject_issuer: str | None = None
    account: AccountPayload | None = None
    workspaces: list[WorkspacePayload] = []
    default_workspace_id: str | None = None


class SessionRow(BaseModel):
    id: str
    prefix: str
    client_id: str
    device_label: str
    created_at: str | None = None
    last_used_at: str | None = None
    expires_at: str | None = None


class SessionListResponse(BaseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[SessionRow]


class RevokeResponse(BaseModel):
    status: str


class WorkspaceSummaryResponse(BaseModel):
    id: str
    name: str
    role: str
    status: str
    current: bool


class WorkspaceListResponse(BaseModel):
    workspaces: list[WorkspaceSummaryResponse]


class WorkspaceDetailResponse(BaseModel):
    id: str
    name: str
    role: str
    status: str
    current: bool
    created_at: str | None = None


class DeviceCodeResponse(BaseModel):
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


class DeviceLookupResponse(BaseModel):
    valid: bool
    expires_in_remaining: int = 0
    client_id: str | None = None


class DeviceMutateResponse(BaseModel):
    status: str


class AppDescribeQuery(BaseModel):
    """`?fields=` allow-list for GET /apps/<id>/describe.

    Empty / omitted → all blocks. Unknown member → ValidationError → 422.
    """

    model_config = ConfigDict(extra="forbid")

    fields: set[str] | None = None
    workspace_id: str | None = None

    @field_validator("workspace_id", mode="before")
    @classmethod
    def _validate_workspace_id(cls, v: object) -> str | None:
        if v is None or v == "":
            return None
        if not isinstance(v, str):
            raise ValueError("workspace_id must be a string")
        try:
            import uuid as _uuid

            _uuid.UUID(v)
        except ValueError:
            raise ValueError("workspace_id must be a valid UUID")
        return v

    @field_validator("fields", mode="before")
    @classmethod
    def _parse_fields(cls, v: object) -> set[str] | None:
        if v is None or v == "":
            return None
        if not isinstance(v, str):
            raise ValueError("fields must be a comma-separated string")
        _ALLOWED_DESCRIBE_FIELDS = frozenset({"info", "parameters", "input_schema"})
        members = {m.strip() for m in v.split(",") if m.strip()}
        unknown = members - _ALLOWED_DESCRIBE_FIELDS
        if unknown:
            raise ValueError(f"unknown field(s): {sorted(unknown)}")
        return members


class AppListQuery(BaseModel):
    """mode is a closed enum."""

    workspace_id: str
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=MAX_PAGE_LIMIT)
    mode: AppMode | None = None
    name: str | None = Field(None, max_length=200)
    tag: str | None = Field(None, max_length=100)


class AppRunRequest(BaseModel):
    inputs: dict[str, Any]
    query: str | None = None
    files: list[dict[str, Any]] | None = None
    response_mode: Literal["blocking", "streaming"] | None = None
    conversation_id: UUIDStrOrEmpty | None = None
    auto_generate_name: bool = True
    workflow_id: str | None = None
    workspace_id: UUIDStrOrEmpty | None = None

    @field_validator("conversation_id", mode="before")
    @classmethod
    def _normalize_conv(cls, value: str | None) -> str | None:
        if isinstance(value, str):
            value = value.strip()
        if not value:
            return None
        try:
            return uuid_value(value)
        except ValueError as exc:
            raise ValueError("conversation_id must be a valid UUID") from exc


class DeviceCodeRequest(BaseModel):
    client_id: str
    device_label: str


class DevicePollRequest(BaseModel):
    device_code: str
    client_id: str


class DeviceLookupQuery(BaseModel):
    user_code: str


class DeviceMutateRequest(BaseModel):
    user_code: str


class PermittedExternalAppsListQuery(BaseModel):
    """Strict (extra='forbid')."""

    model_config = ConfigDict(extra="forbid")

    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=MAX_PAGE_LIMIT)
    mode: AppMode | None = None
    name: str | None = Field(None, max_length=200)
