"""Shared response substructures for openapi endpoints."""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from libs.helper import EmailStr, UUIDStr, UUIDStrOrEmpty, uuid_value
from models.model import AppMode

# Server-side cap on `limit` query param for /openapi/v1/* list endpoints.
MAX_PAGE_LIMIT = 200


class SupportedAppType(StrEnum):
    """App types the ``app`` usage face (``get app``) lists and filters.

    A curated subset of :class:`AppMode`: the real, user-facing app categories.
    Excludes runtime-only mode tags that are not standalone apps
    (``rag-pipeline`` is a knowledge ``Pipeline``; ``channel`` is unused) and the
    roster-owned ``agent`` type (surfaced through the roster, not this list).

    Members reference ``AppMode.*.value`` so the subset relationship is
    type-checked: dropping a member from ``AppMode`` breaks this at import.
    This is the single source for the listable set — params, filters, and the
    generated CLI whitelist all derive from it.
    """

    COMPLETION = AppMode.COMPLETION.value
    CHAT = AppMode.CHAT.value
    ADVANCED_CHAT = AppMode.ADVANCED_CHAT.value
    WORKFLOW = AppMode.WORKFLOW.value
    AGENT_CHAT = AppMode.AGENT_CHAT.value


SUPPORTED_APP_TYPES: Final[tuple[AppMode, ...]] = tuple(AppMode(t.value) for t in SupportedAppType)


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


class AppListRow(BaseModel):
    id: str
    name: str
    description: str | None = None
    mode: AppMode
    updated_at: str | None = None
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


class AppInfo(BaseModel):
    id: str
    name: str
    description: str | None = None
    mode: str


class AppDescribeInfo(AppInfo):
    updated_at: str | None = None
    service_api_enabled: bool
    is_agent: bool = False


class AppDescribeResponse(BaseModel):
    info: AppDescribeInfo | None = None
    parameters: dict[str, Any] | None = Field(default=None)
    input_schema: dict[str, Any] | None = Field(default=None)


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


class DeviceTokenResponse(BaseModel):
    token: str
    expires_at: str
    subject_type: Literal["account", "external_sso"]
    account: AccountPayload | None = None
    workspaces: list[WorkspacePayload] = []
    default_workspace_id: str | None = None
    token_id: str
    subject_email: str | None = None
    subject_issuer: str | None = None


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


class SessionListQuery(BaseModel):
    """Pagination for GET /account/sessions. Strict (extra='forbid')."""

    model_config = ConfigDict(extra="forbid")

    page: int = Field(1, ge=1)
    limit: int = Field(100, ge=1, le=MAX_PAGE_LIMIT)


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


class ServerVersionResponse(BaseModel):
    """Meta endpoint payload for `GET /openapi/v1/_version` — no auth required."""

    version: str
    edition: Literal["SELF_HOSTED", "CLOUD"]


class HealthResponse(BaseModel):
    """Liveness payload for `GET /openapi/v1/_health` — no auth required."""

    ok: bool


def _csv_string_query_schema(schema: dict[str, Any]) -> None:
    """Re-shape a set/list field's query schema to a comma-separated string — the wire form the
    handler actually accepts (`request.args` is flat + the validator splits on ','). Without this
    the generated contract would type it as an array and serialize `fields[0]=…&fields[1]=…`,
    which `extra='forbid'` rejects. Runtime `set[str]` validation is unaffected."""
    schema.pop("anyOf", None)
    schema.pop("items", None)
    schema.pop("uniqueItems", None)
    schema["type"] = "string"


class AppDescribeQuery(BaseModel):
    """`?fields=` allow-list for GET /apps/<id>/describe.

    Empty / omitted → all blocks. Unknown member → ValidationError → 422.
    """

    model_config = ConfigDict(extra="forbid")

    fields: set[str] | None = Field(default=None, json_schema_extra=_csv_string_query_schema)

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
    """mode is a closed enum of listable app types."""

    workspace_id: UUIDStr
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=MAX_PAGE_LIMIT)
    mode: SupportedAppType | None = None
    name: str | None = Field(None, max_length=200)


class AppRunRequest(BaseModel):
    inputs: dict[str, Any]
    query: str | None = None
    files: list[dict[str, Any]] | None = Field(default=None)
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
    mode: SupportedAppType | None = None
    name: str | None = Field(None, max_length=200)


_EMAIL_FIELD = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+$")


class ExtSubjectAssertionClaims(BaseModel):
    email: str = _EMAIL_FIELD
    issuer: str = Field(min_length=1, max_length=255)
    user_code: str = Field(min_length=1, max_length=32)
    nonce: str = Field(min_length=1, max_length=128)


class ApprovalGrantClaimsPayload(BaseModel):
    subject_email: str = _EMAIL_FIELD
    subject_issuer: str = Field(min_length=1, max_length=255)
    user_code: str = Field(min_length=1, max_length=32)
    nonce: str = Field(min_length=1, max_length=128)
    csrf_token: str = Field(min_length=1, max_length=128)


# Closed enum for invite/update-role payloads. Owner is intentionally not
# assignable through these endpoints — ownership transfer goes through the
# console's three-step email-verification flow.
MemberAssignableRole = Literal["normal", "admin"]


class MemberResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    status: str
    avatar: str | None = None


class MemberListResponse(BaseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[MemberResponse]


class MemberListQuery(BaseModel):
    """Strict (extra='forbid')."""

    model_config = ConfigDict(extra="forbid")

    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=MAX_PAGE_LIMIT)


class MemberInvitePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    role: MemberAssignableRole


class MemberRoleUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: MemberAssignableRole


class MemberInviteResponse(BaseModel):
    result: Literal["success"] = "success"
    email: str
    role: str
    member_id: str
    invite_url: str
    tenant_id: str


class MemberActionResponse(BaseModel):
    result: Literal["success"] = "success"


class TaskStopResponse(BaseModel):
    """200 body for POST /apps/<id>/tasks/<task_id>/stop. The handler always returns
    {"result": "success"}, so `result` is required (no default) — the generated contract
    types it as a required `'success'` rather than an optional field."""

    result: Literal["success"]


class AppDslImportPayload(BaseModel):
    """Request body for POST /workspaces/<workspace_id>/apps/imports."""

    model_config = ConfigDict(extra="forbid")

    mode: Literal["yaml-content", "yaml-url"] = Field(..., description="Import mode: yaml-content or yaml-url")
    yaml_content: str | None = Field(None, description="Inline YAML DSL string (required when mode is yaml-content)")
    yaml_url: str | None = Field(None, description="Remote URL to fetch YAML from (required when mode is yaml-url)")
    name: str | None = Field(None, description="Override the app name from the DSL")
    description: str | None = Field(None, description="Override the app description from the DSL")
    icon_type: str | None = Field(None)
    icon: str | None = Field(None)
    icon_background: str | None = Field(None)
    app_id: str | None = Field(None, description="Existing app ID to overwrite (workflow/advanced-chat apps only)")

    @model_validator(mode="after")
    def _validate_source_by_mode(self) -> AppDslImportPayload:
        if self.mode == "yaml-content" and not self.yaml_content:
            raise ValueError("yaml_content is required when mode is 'yaml-content'")
        if self.mode == "yaml-url" and not self.yaml_url:
            raise ValueError("yaml_url is required when mode is 'yaml-url'")
        return self


class AppDslExportQuery(BaseModel):
    """Query parameters for GET /apps/<app_id>/export."""

    include_secret: bool = Field(False, description="Include encrypted secret values in the exported DSL")
    workflow_id: UUIDStr | None = Field(
        None, description="Export a specific workflow version instead of the current draft"
    )


class AppDslExportResponse(BaseModel):
    """Export DSL response."""

    data: str = Field(..., description="DSL YAML string")


class FormSubmitResponse(BaseModel):
    """Empty 200 body for POST /apps/<id>/form/human_input/<token>. `extra='forbid'`
    pins `additionalProperties: false` so the generated contract is an exact `{}` rather
    than an under-annotated open object."""

    model_config = ConfigDict(extra="forbid")


class HumanInputFormDefinitionResponse(BaseModel):
    form_content: str
    inputs: list[dict[str, Any]] = Field(default_factory=list)
    resolved_default_values: dict[str, str]
    user_actions: list[dict[str, Any]] = Field(default_factory=list)
    expiration_time: int | None = None
