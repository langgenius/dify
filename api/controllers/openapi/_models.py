"""Shared response substructures for openapi endpoints."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from enum import StrEnum
from typing import Any, Final, Literal, Protocol, Self

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, ValidationInfo, field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema

from configs import dify_config
from constants.languages import supported_language
from constants.oauth_bearer import SubjectType
from controllers.common.human_input import HumanInputFormSubmitPayload
from controllers.openapi._i18n import localized
from controllers.openapi._upload import UploadPart, UploadParts
from core.entities.mcp_provider import MCPAuthentication, MCPConfiguration
from core.plugin.entities.plugin import PluginCategory
from core.plugin.entities.plugin_daemon import PluginInstallTaskStatus
from core.tools.entities.api_entities import ToolApiEntity
from core.tools.entities.tool_entities import (
    ApiProviderSchemaType,
    ToolProviderType,
    WorkflowToolParameterConfiguration,
)
from core.workflow.nodes.human_input.entities import FormInputConfig, UserActionConfig
from enums import DeploymentEdition, WebAppAccessMode
from fields.workflow_run_fields import WorkflowRunPaginationResponse
from graphon.enums import BuiltinNodeTypes, WorkflowExecutionStatus
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.nodes.tool.entities import ToolInputType
from graphon.variables import SegmentType
from libs.helper import EmailStr, UUIDStr, UUIDStrOrEmpty, alphanumeric, to_timestamp, uuid_value
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode, IconType
from services.entities.app_entities import SupportedAppType
from services.entities.dsl_entities import CheckDependenciesResult, Import, ImportMode
from services.knowledge.entities.knowledge_entities import RetrievalModel
from services.workflow.graph_check import GraphIssue
from services.workflow.graph_diff import WorkflowDiff

# Server-side cap on `limit` query param for /openapi/v1/* list endpoints.
MAX_PAGE_LIMIT = 100


class UsageInfo(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class MessageMetadata(BaseModel):
    usage: UsageInfo | None = None
    retriever_resources: list[dict[str, Any]] = []


class Hint(BaseModel):
    """A next step: the op id to call and its ready input."""

    summary: str
    op: str
    input: dict[str, Any] = Field(description="Ready-to-send input for `op`; unknown values are null")
    form: list[dict[str, Any]] | None = Field(
        default=None, description="Form fields behind the hint's input: a paused run's form inputs, or credentials"
    )


class Hinted(BaseModel):
    """The one place a response carries server-built next steps; `hints` is reserved on every op input."""

    hints: list[Hint] = Field(default_factory=list, description="Next steps the caller can take")


class PageQuery(BaseModel):
    """The two query parameters every list op takes; the next-page hint is built from this model."""

    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=MAX_PAGE_LIMIT)


class PaginationEnvelope[T](Hinted):
    """The one shape every paginated list on this surface answers with."""

    page: int
    limit: int
    total: int
    has_more: bool
    data: list[T]

    @classmethod
    def build(cls, *, page: int, limit: int, total: int, items: list[T]) -> Self:
        return cls(page=page, limit=limit, total=total, has_more=page * limit < total, data=items)

    @classmethod
    def page_of(cls, items: list[T], *, query: PageQuery) -> Self:
        """The page `query` asks for, cut from a list the service returned whole."""
        start = (query.page - 1) * query.limit
        return cls.build(page=query.page, limit=query.limit, total=len(items), items=items[start : start + query.limit])


class AppListRow(BaseModel):
    id: str
    name: str
    description: str | None = None
    mode: AppMode
    updated_at: str | None = None
    workspace_id: str | None = None
    workspace_name: str | None = None


class AppListResponse(PaginationEnvelope[AppListRow]):
    pass


class PermittedExternalAppsListResponse(PaginationEnvelope[AppListRow]):
    pass


class AppInfo(BaseModel):
    id: str
    name: str
    description: str | None = None
    mode: str


class AppDescribeInfo(AppInfo):
    updated_at: str | None = None
    service_api_enabled: bool
    is_agent: bool = Field(False, description="True for agent-chat and advanced-chat apps")


class AppDescribeResponse(Hinted):
    info: AppDescribeInfo | None = None
    parameters: dict[str, Any] | None = Field(default=None)
    input_schema: dict[str, Any] | None = Field(default=None)


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
    subject_type: SubjectType
    account: AccountPayload | None = None
    workspaces: list[WorkspacePayload] = []
    default_workspace_id: str | None = None
    token_id: str
    subject_email: str | None = None
    subject_issuer: str | None = None


class AccountResponse(BaseModel):
    subject_type: SubjectType
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


class SessionListResponse(PaginationEnvelope[SessionRow]):
    pass


class SessionListQuery(PageQuery):
    """Pagination for GET /account/sessions. Strict (extra='forbid')."""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(100, ge=1, le=MAX_PAGE_LIMIT)


class RevokeResponse(BaseModel):
    status: str


class WorkspaceSummaryResponse(BaseModel):
    id: str
    name: str
    role: str
    status: str


class WorkspaceListResponse(PaginationEnvelope[WorkspaceSummaryResponse]):
    pass


class WorkspaceListQuery(PageQuery):
    """Strict (extra='forbid')."""

    model_config = ConfigDict(extra="forbid")


class WorkspaceDetailResponse(BaseModel):
    id: str
    name: str
    role: str
    status: str
    created_at: str | None = None


class DeviceFlowErrorResponse(BaseModel):
    """RFC 8628-style device-flow error. These routes keep the OAuth ``{"error": code}`` shape
    instead of ``ErrorBody`` because device clients parse it."""

    error: Literal[
        "unsupported_client",
        "slow_down",
        "expired_token",
        "authorization_pending",
        "access_denied",
        "expired_or_unknown",
        "already_resolved",
        "approve_in_progress",
        "approval_outcome_unknown",
        "state_lost",
    ]


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


class DeviceApprovalContextResponse(BaseModel):
    subject_email: str
    subject_issuer: str
    user_code: str
    csrf_token: str
    expires_at: datetime


class ServerVersionResponse(BaseModel):
    """Meta endpoint payload for `GET /openapi/v1/_version` — no auth required."""

    version: str
    edition: DeploymentEdition


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
    """`?fields=` allow-list for GET /apps/<id>.

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
        _allowed_describe_fields = frozenset({"info", "parameters", "input_schema"})
        members = {m.strip() for m in v.split(",") if m.strip()}
        unknown = members - _allowed_describe_fields
        if unknown:
            raise ValueError(f"unknown field(s): {sorted(unknown)}")
        return members


class AppListQuery(PageQuery):
    """mode is a closed enum of listable app types."""

    workspace_id: UUIDStr
    mode: SupportedAppType | None = None
    name: str | None = Field(
        None,
        max_length=200,
        description="Filter by a name substring; an app id returns that one app and ignores `mode`",
    )


class _ConversationFields(BaseModel):
    conversation_id: UUIDStrOrEmpty | None = Field(default=None, description="Continue an existing conversation")
    auto_generate_name: bool = Field(default=True, description="Let the server name a new conversation")

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


class _WorkflowVersionFields(BaseModel):
    workflow_id: str | None = Field(default=None, description="Pin a published workflow version")


class RunPayloadBase(BaseModel):
    """What every run takes; each mode's payload adds its own fields and forbids the rest."""

    inputs: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Variables declared by the app. The exact shape is per app: read `input_schema` from "
            "describe.console_app. A file variable takes a Dify file mapping (remote url or upload id) here, "
            "or a local path in `files`, not both."
        ),
    )
    files: UploadParts | None = Field(
        default=None,
        description=(
            "Local file paths keyed by the app's file variable name; each file is uploaded and becomes "
            "that variable's value. Give a list of paths for a file-list variable"
        ),
    )
    attachments: list[UploadPart] | None = Field(
        default=None,
        description="Local file paths attached to the run itself (the app's `sys.files`), not to a variable",
    )
    workspace_id: UUIDStrOrEmpty | None = Field(default=None, description="Workspace that owns the app")


class WorkflowRunPayload(RunPayloadBase, _WorkflowVersionFields):
    model_config = ConfigDict(extra="forbid")


class DraftWorkflowRunPayload(RunPayloadBase):
    model_config = ConfigDict(extra="forbid")


class ChatRunPayload(RunPayloadBase, _ConversationFields):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(description="User message")

    @field_validator("query")
    @classmethod
    def _non_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("query must not be blank")
        return value


class AdvancedChatRunPayload(ChatRunPayload, _WorkflowVersionFields):
    """A chat run against an advanced-chat (chatflow) app, which can also pin a workflow version."""

    model_config = ConfigDict(extra="forbid")


class CompletionRunPayload(RunPayloadBase):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(default="", description="Prompt text; most completion apps take their input through `inputs`")


class FileUploadPayload(BaseModel):
    file: UploadPart = Field(
        description="The file to upload; its id can then be used in an app run's file variables",
    )


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


class PermittedExternalAppsListQuery(PageQuery):
    """Strict (extra='forbid')."""

    model_config = ConfigDict(extra="forbid")

    mode: SupportedAppType | None = None
    name: str | None = Field(None, max_length=200)


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


class MemberListResponse(PaginationEnvelope[MemberResponse]):
    pass


class MemberListQuery(PageQuery):
    """Strict (extra='forbid')."""

    model_config = ConfigDict(extra="forbid")


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


class MarketplacePluginQuery(PageQuery):
    model_config = ConfigDict(extra="forbid")

    query: str = Field("", description="Words to search for; empty lists the most installed plugins")
    category: PluginCategory | None = Field(None, description="Only plugins of this category")


class MarketplacePluginRow(BaseModel):
    plugin_id: str
    identifier: str = Field(description="Latest versioned id; pass it to install.plugin")
    version: str
    category: str
    label: str | None
    brief: str | None
    authorized_category: str | None = Field(
        description=(
            "Who vouches for the plugin: langgenius (official), partner or community; "
            "workspace install-scope rules check this"
        )
    )
    install_count: int
    installed: bool
    installed_version: str | None


class MarketplacePluginListResponse(PaginationEnvelope[MarketplacePluginRow]):
    pass


class PluginListQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: PluginCategory | None = Field(None, description="Only plugins of this category")


class PluginProvides(BaseModel):
    model_provider: str | None = Field(description="Model provider id this plugin adds, for describe.model_provider")
    tool_provider: str | None = Field(description="Tool provider id this plugin adds, for describe.tool_provider")


class PluginRow(BaseModel):
    plugin_id: str
    identifier: str
    version: str
    latest_version: str | None
    category: str
    label: str | None
    source: str
    provides: PluginProvides


class PluginListResponse(Hinted):
    data: list[PluginRow]


class PluginInstallPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    identifiers: list[str] = Field(
        min_length=1,
        description=(
            "Versioned plugin ids such as langgenius/openai:0.2.1@sha256…, from get.marketplace.plugin "
            "(identifier) or check.console_app.dependency"
        ),
    )


class PluginTaskStartResponse(Hinted):
    task_id: str
    all_installed: bool


class PluginTaskItem(BaseModel):
    plugin_id: str
    identifier: str
    status: PluginInstallTaskStatus
    message: str


class PluginTaskResponse(Hinted):
    task_id: str
    status: PluginInstallTaskStatus
    plugins: list[PluginTaskItem]


class PluginDeleteResponse(BaseModel):
    plugin_id: str
    deleted: bool


class CheckDependenciesResponse(CheckDependenciesResult, Hinted):
    pass


class TaskStopResponse(BaseModel):
    """200 body for POST /apps/<id>/runs/<run_id>:stop and POST /apps/<id>/tasks/<task_id>:stop.
    The handlers always return {"result": "success"}, so `result` is required (no default) — the generated contract
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
    draft_hash: str | None = Field(
        None,
        description="draft_hash from the export or restore this import is based on. The import fails if the "
        "draft's graph, features, environment variables or conversation variables changed since. Requires app_id",
    )
    _source: str = PrivateAttr()

    @model_validator(mode="after")
    def _validate_source_by_mode(self) -> AppDslImportPayload:
        if self.draft_hash is not None and not self.app_id:
            raise ValueError("draft_hash is only valid when app_id names the app to overwrite")
        source = self.yaml_url if self.mode == ImportMode.YAML_URL else self.yaml_content
        if not source:
            raise ValueError(f"{self.mode.replace('-', '_')} is required when mode is '{self.mode}'")
        self._source = source
        return self

    @property
    def source(self) -> str:
        """The URL or the YAML text, whichever the mode names."""
        return self._source


class AppDslExportQuery(BaseModel):
    """Query parameters for GET /apps/<app_id>/dsl."""

    include_secret: bool = Field(False, description="Include secret values in plaintext in the exported DSL")
    workflow_id: UUIDStr | None = Field(
        None, description="Export a specific workflow version instead of the current draft"
    )


class AppDslExportResponse(BaseModel):
    """Export DSL response."""

    data: str = Field(..., description="DSL YAML string")
    draft_hash: str | None = Field(
        None,
        description="Hash of the draft's graph, features, environment variables and conversation variables; "
        "pass it to the import to refuse overwriting newer edits",
    )


class AppDslImportResponse(Import, Hinted):
    """`Import` plus the server-built next step for a pending import."""


class DslCheckPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    yaml_content: str = Field(description="The DSL to check, as YAML text")
    app_id: str | None = Field(None, description="Check against this existing app's mode, as an overwrite import would")


class DslIssueRow(BaseModel):
    code: str
    severity: str = Field(description="error: import refuses it; warning: import allows it, the release check does not")
    node_id: str | None
    loc: list[str | int]
    message: str

    @classmethod
    def of(cls, issue: GraphIssue) -> DslIssueRow:
        return cls(
            code=issue.code,
            severity=issue.code.severity,
            node_id=issue.node_id,
            loc=list(issue.loc),
            message=issue.message,
        )


class DslCheckResponse(Hinted):
    valid: bool = Field(description="No error-severity issues")
    issues: list[DslIssueRow]


class ReleaseCheckName(StrEnum):
    DRAFT_VALID = "draft_valid"
    TESTED = "tested"


class ReleaseCheckRow(BaseModel):
    name: ReleaseCheckName
    passed: bool
    detail: str


class ReleaseState(BaseModel):
    service_api_enabled: bool
    webapp_enabled: bool


class ReleaseCheckResponse(Hinted):
    ready: bool = Field(description="Every check passed; show the human `changes` and ask before publishing")
    checks: list[ReleaseCheckRow]
    issues: list[DslIssueRow]
    state: ReleaseState
    changes: WorkflowDiff


class FormSubmitResponse(Hinted):
    """200 body for POST /apps/<id>/human-input-forms/<token>:submit: the hint to follow the
    resumed run. `extra='forbid'` pins `additionalProperties: false` so the generated contract
    is exact rather than an under-annotated open object."""

    model_config = ConfigDict(extra="forbid")


class OpenApiFormSubmitPayload(HumanInputFormSubmitPayload):
    """The console payload plus local file parts; `_files.merge_files` sets them on `inputs`."""

    files: UploadParts | None = Field(
        default=None,
        description="Local file paths keyed by the form's file input name, same convention as the run ops' `files`",
    )


class HumanInputFormDefinitionResponse(BaseModel):
    form_content: str
    inputs: list[FormInputConfig] = Field(default_factory=list)
    resolved_default_values: dict[str, str]
    user_actions: list[UserActionConfig] = Field(default_factory=list)
    expiration_time: int | None = None


class RunListQuery(BaseModel):
    last_id: UUIDStr | None = Field(None, description="Cursor: id of the last run on the previous page")
    limit: int = Field(20, ge=1, le=MAX_PAGE_LIMIT)
    status: (
        Literal[
            WorkflowExecutionStatus.RUNNING,
            WorkflowExecutionStatus.SUCCEEDED,
            WorkflowExecutionStatus.FAILED,
            WorkflowExecutionStatus.STOPPED,
            WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
        ]
        | None
    ) = None
    triggered_from: Literal[WorkflowRunTriggeredFrom.DEBUGGING, WorkflowRunTriggeredFrom.APP_RUN] = Field(
        WorkflowRunTriggeredFrom.DEBUGGING,
        description="debugging: draft test runs, as in the console; app-run: real use",
    )


class RunListResponse(WorkflowRunPaginationResponse, Hinted):
    """Cursor page of runs; `hints` carries the next page."""


class PublishPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    marked_name: str = Field("", max_length=20, description="Version name")
    marked_comment: str = Field("", max_length=100, description="Version note")


class PublishResponse(BaseModel):
    version_id: str
    created_at: int
    warning: str | None = Field(None, description="Variable references that may read a skipped branch")


class VersionListQuery(PageQuery):
    named_only: bool = Field(False, description="Only versions that have a name")


class VersionRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    marked_name: str
    marked_comment: str
    created_by: str | None = None
    created_at: int
    current: bool = False

    @field_validator("created_at", mode="before")
    @classmethod
    def _timestamp(cls, value: datetime | int) -> int | None:
        return to_timestamp(value)


class VersionListResponse(Hinted):
    """Page of published versions, newest first; there is no total, `hints` carries the next page."""

    page: int
    limit: int
    has_more: bool
    data: list[VersionRow]


class EnvVariableRow(BaseModel):
    id: str = Field(description="What set and delete take to address this variable")
    name: str = Field(description="What nodes use to refer to this variable")
    description: str = ""
    value_type: str
    value: Any = Field(description="The value; a secret with a value is masked, an empty one reads as empty")


class EnvVariableListResponse(BaseModel):
    data: list[EnvVariableRow]


class EnvVariableValueType(StrEnum):
    """Value types the draft environment-variable ``set`` op accepts.

    A curated subset of ``SegmentType``: what the console's environment-variable editor
    allows (``ENVIRONMENT_VARIABLE_SUPPORTED_TYPES`` in controllers/console/app/workflow.py).
    Members reference ``SegmentType.*.value`` so the subset relationship is type-checked.
    """

    STRING = SegmentType.STRING.value
    NUMBER = SegmentType.NUMBER.value
    SECRET = SegmentType.SECRET.value


class EnvVariableSetPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(description="Variable name")
    value_type: EnvVariableValueType = Field(description="string, number or secret")
    value: Any = Field(description="The value; sending the masked value of an existing secret keeps the stored one")
    description: str = Field("", description="What the variable is for")


class RestoreResponse(BaseModel):
    result: Literal["success"]
    draft_hash: str = Field(
        description="Hash of the restored draft's graph, features, environment variables and conversation "
        "variables; pass it to a DSL import as draft_hash"
    )


class NodeTypeRow(BaseModel):
    type: str
    version: str


class NodeTypeListResponse(BaseModel):
    data: list[NodeTypeRow]


class NodeTypeDetailResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: str
    version: str
    schema_: dict[str, Any] = Field(alias="schema")
    default_config: dict[str, Any]


AppIconType = Literal[IconType.EMOJI, IconType.IMAGE, IconType.LINK]


class CreateAppPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, description="App name")
    description: str | None = Field(default=None, max_length=400, description="App description")
    icon_type: AppIconType | None = Field(default=None, description="emoji, image or link")
    icon: str | None = Field(default=None, description="Emoji, file id or URL, per icon_type")
    icon_background: str | None = Field(default=None, description="Background colour for an emoji icon")


class CreatedAppResponse(BaseModel):
    app_id: str
    mode: str
    name: str


class AppSettingsInfo(BaseModel):
    name: str
    description: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    max_active_requests: int | None = None


class ChatAppInfo(AppSettingsInfo):
    use_icon_as_answer_icon: bool = False


class AgentAppInfo(ChatAppInfo):
    role: str | None = None


class AppInfoPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, description="App name")
    description: str | None = Field(default=None, max_length=400, description="Pass an empty string to clear")
    icon_type: AppIconType | None = Field(default=None, description="emoji, image or link")
    icon: str | None = Field(default=None, description="Emoji, file id or URL, per icon_type")
    icon_background: str | None = Field(default=None, description="Background colour for an emoji icon")
    max_active_requests: int | None = Field(
        default=None,
        ge=0,
        description="Concurrent run cap; 0 uses the server default. The server-wide cap still applies",
    )


class ChatAppInfoPatch(AppInfoPatch):
    use_icon_as_answer_icon: bool | None = Field(default=None, description="Show the app icon on answers")


class AgentAppInfoPatch(ChatAppInfoPatch):
    role: str | None = Field(default=None, max_length=255, description="The agent's role; empty string clears it")


class ServiceApi(BaseModel):
    enabled: bool
    base_url: str


class AgentServiceApi(ServiceApi):
    access_ready: bool
    api_rpm: int = 0
    api_rph: int = 0


class ServiceApiPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = Field(description="Turn the app's Service API on or off")


class NodeRunPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inputs: dict[str, Any] = Field(
        default_factory=dict,
        description="Overrides for what the last draft run saved, keyed by variable reference such as #llm.text#",
    )
    files: UploadParts | None = Field(
        default=None,
        description=(
            "Local file paths keyed by the file variable name (a start variable or #node.var#); each is uploaded"
        ),
    )


class AdvancedChatNodeRunPayload(NodeRunPayload):
    query: str = Field(default="", description="The user message the node sees as sys.query")


class WebApp(BaseModel):
    enabled: bool
    access_token: str | None = None
    app_base_url: str
    url: str | None = None
    title: str | None = None
    description: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    default_language: str | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    custom_disclaimer: str | None = None


class WorkflowWebApp(WebApp):
    show_workflow_steps: bool = False


class ChatWebApp(WebApp):
    chat_color_theme: str | None = None
    chat_color_theme_inverted: bool = False
    use_icon_as_answer_icon: bool = False
    input_placeholder: str | None = None


class AdvancedChatWebApp(ChatWebApp):
    show_workflow_steps: bool = False


class AgentWebApp(ChatWebApp):
    access_ready: bool


class WebAppPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = Field(default=None, description="Turn the web app on or off")
    title: str | None = Field(default=None, description="Page title")
    description: str | None = Field(default=None, description="Page description")
    icon_type: AppIconType | None = Field(default=None, description="emoji, image or link")
    icon: str | None = Field(default=None, description="Emoji, file id or URL, per icon_type")
    icon_background: str | None = Field(default=None, description="Background colour for an emoji icon")
    default_language: str | None = Field(default=None, description="Language code, e.g. en-US")
    copyright: str | None = Field(default=None, description="Footer copyright text")
    privacy_policy: str | None = Field(default=None, description="Privacy policy URL")
    custom_disclaimer: str | None = Field(default=None, description="Disclaimer shown on the page")

    @field_validator("default_language")
    @classmethod
    def _language(cls, value: str | None) -> str | None:
        return value if value is None else supported_language(value)


class WorkflowWebAppPatch(WebAppPatch):
    show_workflow_steps: bool | None = Field(default=None, description="Show each node step to users")


class ChatWebAppPatch(WebAppPatch):
    chat_color_theme: str | None = Field(default=None, description="Chat colour, e.g. #1C64F2")
    chat_color_theme_inverted: bool | None = Field(default=None, description="Invert the chat colours")
    use_icon_as_answer_icon: bool | None = Field(default=None, description="Show the app icon on answers")
    input_placeholder: str | None = Field(default=None, description="Placeholder of the chat input")


class AdvancedChatWebAppPatch(ChatWebAppPatch):
    show_workflow_steps: bool | None = Field(default=None, description="Show each node step to users")


class WebAppToken(BaseModel):
    access_token: str | None = None
    app_base_url: str
    url: str | None = None


class WebAppAccess(BaseModel):
    access_mode: str


class WebAppAccessPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_mode: WebAppAccessMode = Field(
        description="public, private_all or sso_verified. Choose specific members (private) in the Dify console"
    )


class _FormOption(Protocol):
    value: str


class _FormShowOn(Protocol):
    variable: str
    value: str


class CredentialFormField(BaseModel):
    name: str
    type: str
    required: bool
    label: str | None
    placeholder: str | None
    options: list[str] | None = Field(description="Allowed values, when the field is a choice")
    show_on: list[dict[str, str]] = Field(description="Show this field only when these other fields have these values")

    @classmethod
    def of(
        cls,
        *,
        name: str,
        type: object,
        required: bool,
        label: BaseModel | None,
        placeholder: BaseModel | None,
        options: Sequence[_FormOption] | None,
        show_on: Sequence[_FormShowOn] = (),
        language: str | None,
    ) -> CredentialFormField:
        """A model or tool provider's credential form field, cut to what a caller needs."""
        return cls(
            name=name,
            type=str(type),
            required=required,
            label=localized(label, language),
            placeholder=localized(placeholder, language),
            options=[option.value for option in options] if options else None,
            show_on=[{"variable": rule.variable, "value": rule.value} for rule in show_on],
        )


class CredentialRef(BaseModel):
    id: str
    name: str | None


class ModelProviderRow(BaseModel):
    provider: str = Field(description="Provider id such as langgenius/openai/openai")
    label: str | None
    model_types: list[str]
    configured: bool
    active_credential: CredentialRef | None


class CustomModelRow(BaseModel):
    model: str
    model_type: str
    active_credential: CredentialRef | None


class ModelProviderDetailResponse(ModelProviderRow, Hinted):
    credential_form: list[CredentialFormField]
    credentials: list[CredentialRef]
    custom_model_form: list[CredentialFormField] | None
    custom_models: list[CustomModelRow]


_CREDENTIALS_DESCRIPTION: Final = "Secret values, keyed by the field names in credential_form of the describe op."
_CREDENTIALS_UPDATE_DESCRIPTION: Final = (
    _CREDENTIALS_DESCRIPTION + " Send [__HIDDEN__] for a secret you keep unchanged."
)


class ProviderCredentialCreatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credentials: dict[str, Any] = Field(description=_CREDENTIALS_DESCRIPTION)
    name: str | None = Field(None, description="Credential name; the server makes one when absent")


class ProviderCredentialUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credentials: dict[str, Any] = Field(description=_CREDENTIALS_UPDATE_DESCRIPTION)
    name: str | None = None


class CredentialWriteResponse(Hinted):
    id: str
    name: str | None
    active: bool


class ToolProviderRow(BaseModel):
    provider: str = Field(description="Tool provider id such as langgenius/tavily/tavily")
    label: str | None
    configured: bool = Field(description="Ready to use: needs no credential, or the workspace has one")
    credential_types: list[str] = Field(description="api-key can be set here; oauth2 needs the console")


class ToolProviderDetailResponse(ToolProviderRow, Hinted):
    credential_form: list[CredentialFormField] = Field(description="Fields of an api-key credential")
    credentials: list[CredentialRef]
    default_credential: CredentialRef | None


class ToolCredentialCreatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credentials: dict[str, Any] = Field(description=_CREDENTIALS_DESCRIPTION)
    name: str | None = Field(None, max_length=30)


class ToolCredentialUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credentials: dict[str, Any] = Field(description=_CREDENTIALS_UPDATE_DESCRIPTION)
    name: str | None = Field(None, max_length=30)


class ToolSource(StrEnum):
    """Tool provider types a workflow tool node can call; values match the node's provider_type."""

    BUILTIN = ToolProviderType.BUILT_IN.value
    WORKFLOW = ToolProviderType.WORKFLOW.value
    API = ToolProviderType.API.value
    MCP = ToolProviderType.MCP.value


class ToolListQuery(PageQuery):
    model_config = ConfigDict(extra="forbid")

    query: str = Field("", description="Words to match in the tool name or label, or the provider id or label")
    provider_type: ToolSource | None = Field(None, description="Only tools of this provider type")
    provider: str | None = Field(None, description="Only this provider's tools")


class ToolInputValue(BaseModel):
    type: ToolInputType = ToolInputType.CONSTANT
    value: Any = None


class ToolParameterRow(BaseModel):
    name: str
    label: str | None
    type: str
    form: str = Field(description="llm: goes in tool_parameters; form: goes in tool_configurations; schema: fixed")
    required: bool
    default: Any
    options: list[str]
    min: float | None
    max: float | None
    llm_description: str | None


TOOL_NODE_VERSION: Final = "2"


class ToolNodeTemplate(BaseModel):
    """A tool node's data with every value as {type, value}."""

    type: str = BuiltinNodeTypes.TOOL
    title: str
    provider_type: str
    provider_id: str
    provider_name: str
    plugin_id: str | None
    plugin_unique_identifier: str | None
    tool_name: str
    tool_label: str
    tool_node_version: str = TOOL_NODE_VERSION
    tool_parameters: dict[str, ToolInputValue]
    tool_configurations: dict[str, ToolInputValue]


class ToolRow(BaseModel):
    provider: str
    provider_type: str
    provider_label: str | None
    configured: bool = Field(
        description=(
            "Ready to use: needs no credential, or the workspace has one. MCP: authorize or refresh in the console"
        )
    )
    name: str
    label: str
    description: str | None
    parameters: list[ToolParameterRow]
    node_data: ToolNodeTemplate = Field(
        description=(
            "Use as the tool node's data; fill every null value; pass upstream values as "
            '{type: mixed, value: "{{#node.var#}}"} or {type: variable, value: [node, var]}'
        )
    )


class ToolListResponse(PaginationEnvelope[ToolRow]):
    pass


class ModelListQuery(PageQuery):
    model_config = ConfigDict(extra="forbid")

    provider: str | None = Field(None, description="Only this provider's models, such as langgenius/openai/openai")
    model_type: ModelType | None = Field(None, description="Only models of this type")
    query: str = Field("", description="Words to match in the model name, label or provider")


class LlmModelBlock(BaseModel):
    provider: str
    name: str
    mode: str
    completion_params: dict[str, Any] = Field(default_factory=dict)


class ModelRow(BaseModel):
    provider: str
    provider_label: str | None
    model: str
    model_type: str
    label: str | None
    status: str = Field(description="active means usable now; anything else needs the provider set up")
    features: list[str]
    node_model: LlmModelBlock | None = Field(None, description="LLM rows: paste as the node's model")


class ModelListResponse(PaginationEnvelope[ModelRow]):
    pass


KNOWLEDGE_TOP_K: Final = 4


class MultipleRetrievalFragment(BaseModel):
    top_k: int = KNOWLEDGE_TOP_K
    reranking_enable: bool = False


class KnowledgeRetrievalFragment(BaseModel):
    dataset_ids: list[str]
    retrieval_mode: Literal["multiple"] = "multiple"
    multiple_retrieval_config: MultipleRetrievalFragment = Field(default_factory=MultipleRetrievalFragment)


class KnowledgeBaseListQuery(PageQuery):
    model_config = ConfigDict(extra="forbid")

    query: str = Field("", description="Words to match in the knowledge base name")


class KnowledgeBaseRow(BaseModel):
    id: str
    name: str
    description: str | None
    provider: str = Field(description="vendor: indexed in Dify; external: an external knowledge API")
    indexing_technique: str | None
    document_count: int
    usable: bool = Field(description="false when its embedding model isn't available in this workspace")
    node_data: KnowledgeRetrievalFragment = Field(
        description=(
            "Merge into a knowledge-retrieval node's data and set query_variable_selector; "
            "to search several bases, join their dataset_ids. For rerank or weights read describe node_type"
        )
    )


class KnowledgeBaseListResponse(PaginationEnvelope[KnowledgeBaseRow]):
    pass


class ModelRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = Field(description="Model name, as in get.model")
    model_type: ModelType


class ModelCredentialCreatePayload(ModelRef):
    credentials: dict[str, Any] = Field(description=_CREDENTIALS_DESCRIPTION)
    name: str | None = None


class ModelCredentialUpdatePayload(ModelRef):
    credentials: dict[str, Any] = Field(description=_CREDENTIALS_UPDATE_DESCRIPTION)
    name: str | None = None


class SkillListQuery(PageQuery):
    model_config = ConfigDict(extra="forbid")

    keyword: str | None = Field(
        None, max_length=200, description="Words to match in the name, display name or description"
    )
    tag: list[str] | None = Field(None, description="Only skills with every one of these tags; repeat to give several")


class SkillRow(BaseModel):
    id: str
    name: str
    display_name: str
    description: str
    icon: str | None
    tags: list[str]
    updated_at: int
    latest_published_version_id: str | None = Field(description="Null while the skill has never been published")


class SkillListResponse(PaginationEnvelope[SkillRow]):
    pass


class SkillVersionRow(BaseModel):
    id: str
    version_number: int
    version_name: str | None
    publish_note: str
    created_at: int
    created_by: str | None = Field(validation_alias="published_by", description="Account id that published it")


class SkillDescribeResponse(SkillRow, Hinted):
    draft_hash: str = Field(description="Opaque; names the draft this was read from")
    latest_version: SkillVersionRow | None = Field(description="Null while the skill has never been published")


class SkillVersionListQuery(PageQuery):
    model_config = ConfigDict(extra="forbid")


class SkillVersionListResponse(PaginationEnvelope[SkillVersionRow]):
    pass


class SkillExportQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_id: UUIDStr | None = Field(None, description="Export this published version instead of the draft")


class SkillPublishPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_name: str | None = Field(None, max_length=128, description="Name for the new version")
    publish_note: str = Field("", max_length=1024, description="Note for the new version")


class SkillPublishResponse(SkillVersionRow, Hinted):
    pass


class SkillImportPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    files: UploadParts = Field(description="The skill folder, one part per file; SKILL.md at its root")
    skill_id: UUIDStr | None = Field(None, description="Overwrite this skill's draft; omit to create a new skill")
    draft_hash: str | None = Field(
        None,
        pattern=r"^[0-9]+$",
        description="From describe.skill; rejects the overwrite if the draft changed since",
    )

    @field_validator("draft_hash")
    @classmethod
    def _needs_skill_id(cls, value: str | None, info: ValidationInfo) -> str | None:
        if value is not None and info.data.get("skill_id") is None:
            raise ValueError("draft_hash only applies to an overwrite; give skill_id too")
        return value


class SkillImportResponse(Hinted):
    id: str
    name: str
    draft_hash: str = Field(description="Opaque; names the draft this wrote")
    file_count: int


class AppApiKeyRow(BaseModel):
    """One app API key; `token` is the full secret, as the console returns it."""

    id: str
    token: str
    created_at: int | None = None
    last_used_at: int | None = None

    @field_validator("created_at", "last_used_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AppApiKeyListResponse(BaseModel):
    """Every API key of one app; unpaginated, as the console lists them."""

    data: list[AppApiKeyRow]


class ModelConfigFrom(StrEnum):
    """Which credential table a model's load-balancing entries point at, as the console's config_from."""

    PREDEFINED_MODEL = "predefined-model"
    CUSTOM_MODEL = "custom-model"


class ModelRefQuery(ModelRef):
    """The model a credential or settings op addresses, as query parameters."""


class DefaultModelPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(description="Provider id such as langgenius/openai/openai")
    model: str


class DefaultModelResponse(BaseModel):
    model_type: str
    provider: str | None = Field(description="Null when no default is set for the type")
    model: str | None = Field(description="Null when no default is set for the type")


class ModelSettingsQuery(ModelRef):
    config_from: ModelConfigFrom = Field(
        description="predefined-model: entries point at provider credentials; custom-model: at the model's own"
    )


class LoadBalancingEntry(BaseModel):
    id: str
    name: str
    credential_id: str | None
    enabled: bool
    inherit: bool = Field(description="True for the entry that reuses the active credential")


class LoadBalancingSettings(BaseModel):
    enabled: bool
    entries: list[LoadBalancingEntry]


class ModelSettingsResponse(ModelSettingsQuery):
    enabled: bool = Field(description="False while the model is disabled for this workspace")
    load_balancing: LoadBalancingSettings


class LoadBalancingEntryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential_id: str | None = Field(
        None, description="A saved credential's id; null names the entry that reuses the active credential"
    )
    enabled: bool


class LoadBalancingPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    entries: list[LoadBalancingEntryPayload] = Field(description="Desired entries; unlisted ones are deleted")


class ModelSettingsPutPayload(ModelSettingsQuery):
    enabled: bool
    load_balancing: LoadBalancingPayload = Field(description="Load-balancing settings to replace the stored ones")

    @model_validator(mode="after")
    def _unique_credentials(self) -> Self:
        seen: set[str] = set()
        inherit = 0
        for entry in self.load_balancing.entries:
            if entry.credential_id is None:
                inherit += 1
            elif entry.credential_id in seen:
                raise ValueError(f"duplicate credential_id {entry.credential_id}")
            else:
                seen.add(entry.credential_id)
        if inherit > 1:
            raise ValueError("at most one entry may reuse the active credential")
        return self


class ToolEmojiIcon(BaseModel):
    model_config = ConfigDict(extra="forbid")

    background: str
    content: str


class ApiToolProviderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str = Field(description="Provider name; on update it may differ from the path to rename")
    icon: ToolEmojiIcon = Field(description="Emoji tile the workspace shows for the provider")
    credentials: dict[str, Any] = Field(description="Auth configuration the provider's calls send")
    schema_type: ApiProviderSchemaType
    schema_: str = Field(alias="schema", description="The schema text that defines the provider's tools")
    privacy_policy: str | None = None
    custom_disclaimer: str | None = None
    labels: list[str] | None = None


class ApiToolProviderResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    icon: ToolEmojiIcon
    schema_type: ApiProviderSchemaType
    schema_: str = Field(alias="schema")
    credentials: dict[str, Any] = Field(description="Masked secret values; never the stored secrets")
    privacy_policy: str | None
    custom_disclaimer: str | None
    labels: list[str]
    tools: list[str] = Field(description="Names of the tools the schema defines")
    description: str | None = None


class ApiToolProviderRow(BaseModel):
    """One API tool provider summary, as a workspace list shows it."""

    name: str
    icon: dict[str, str] | str
    description: str | None
    labels: list[str]
    tools: list[str] = Field(description="Names of the tools the provider's schema defines")


class ApiToolProviderListQuery(PageQuery):
    model_config = ConfigDict(extra="forbid")


class ApiToolProviderListResponse(PaginationEnvelope[ApiToolProviderRow]):
    pass


class McpProviderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    server_url: str
    name: str
    icon: str
    icon_type: str
    icon_background: str = ""
    server_identifier: str
    configuration: MCPConfiguration | None = Field(
        None, description="Connection settings such as timeouts; defaults apply when omitted"
    )
    headers: dict[str, str] | None = Field(None, description="Extra HTTP headers sent to the server")
    authentication: MCPAuthentication | None = Field(
        None, description="OAuth client configuration for servers that require it"
    )

    @field_validator("authentication", "configuration", mode="before")
    @classmethod
    def _empty_to_none(cls, value: object) -> object:
        if value == {}:
            return None
        return value


class McpProviderResponse(BaseModel):
    """An MCP provider with every secret field already masked by the service."""

    id: str
    name: str
    icon: str | dict[str, str]
    server_url: str | None = Field(description="Masked server URL")
    server_identifier: str | None
    masked_headers: dict[str, str] | None
    authentication: MCPAuthentication | None = Field(description="Masked OAuth client config")
    is_team_authorization: bool = Field(description="True once the workspace authorized the provider")
    is_dynamic_registration: bool
    configuration: MCPConfiguration | None
    identity_mode: str
    updated_at: int
    tools: list[str] = Field(description="Names of the tools the server advertised")


class WorkflowToolCreatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_app_id: str = Field(description="The workflow app to publish as a tool")
    name: str
    label: str
    icon: ToolEmojiIcon = Field(description="Emoji tile the workspace shows for the tool")
    description: str
    parameters: list[WorkflowToolParameterConfiguration] = Field(default_factory=list)
    privacy_policy: str | None = None
    labels: list[str] | None = None

    @field_validator("workflow_app_id")
    @classmethod
    def _valid_app_id(cls, value: str) -> str:
        return uuid_value(value)

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str) -> str:
        return alphanumeric(value)


class WorkflowToolSetPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    label: str
    icon: ToolEmojiIcon = Field(description="Emoji tile the workspace shows for the tool")
    description: str
    parameters: list[WorkflowToolParameterConfiguration] = Field(default_factory=list)
    privacy_policy: str | None = None
    labels: list[str] | None = None

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str) -> str:
        return alphanumeric(value)


class WorkflowToolResponse(BaseModel):
    name: str
    label: str
    workflow_tool_id: str
    workflow_app_id: str
    icon: ToolEmojiIcon
    description: str
    parameters: list[WorkflowToolParameterConfiguration]
    output_schema: dict[str, Any]
    tool: ToolApiEntity
    synced: bool = Field(description="False once the app's published workflow moved past this tool's version")
    privacy_policy: str | None


def _check_retrieval_model(value: object) -> None:
    """Reject invalid retrieval settings at body validation instead of inside the handler.

    The field stays a JSON object so the catalog's input schema remains flat;
    validating it with `RetrievalModel` here still turns bad settings into a 422.
    """
    RetrievalModel.model_validate(value)


class DatasetPermission(StrEnum):
    """Who can reach a knowledge base."""

    ONLY_ME = "only_me"
    ALL_TEAM_MEMBERS = "all_team_members"
    PARTIAL_MEMBERS = "partial_members"


class DatasetIndexingTechnique(StrEnum):
    """How a knowledge base indexes its documents."""

    HIGH_QUALITY = "high_quality"
    ECONOMY = "economy"


class DocumentForm(StrEnum):
    """Chunking shape of a document."""

    TEXT_MODEL = "text_model"
    HIERARCHICAL_MODEL = "hierarchical_model"
    QA_MODEL = "qa_model"


class DatasetProvider(StrEnum):
    """Whether the knowledge base indexes locally or proxies an external knowledge API."""

    VENDOR = "vendor"
    EXTERNAL = "external"


class DocumentDisplayStatus(StrEnum):
    """Public document status shared with the legacy service API."""

    QUEUING = "queuing"
    INDEXING = "indexing"
    PAUSED = "paused"
    ERROR = "error"
    AVAILABLE = "available"
    DISABLED = "disabled"
    ARCHIVED = "archived"


class DatasetCreatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40, description="Knowledge base name")
    description: str = Field(
        "", max_length=dify_config.DATASET_DESCRIPTION_MAX_LENGTH, description="Knowledge base description"
    )
    indexing_technique: DatasetIndexingTechnique | None = Field(
        default=None,
        description="`high_quality` uses embedding models; `economy` uses keyword indexing.",
    )
    permission: DatasetPermission | None = Field(
        default=None,
        description="Legacy dataset permission. Only `only_me` and `all_team_members` are "
        "supported when RBAC is disabled. Ignored when RBAC is enabled.",
    )
    provider: DatasetProvider = Field(
        default=DatasetProvider.VENDOR,
        description="`vendor` for internal knowledge bases, `external` for external ones.",
    )
    external_knowledge_api_id: str | None = Field(
        default=None, description="External knowledge API id (required when `provider` is `external`)."
    )
    external_knowledge_id: str | None = Field(
        default=None, description="External knowledge base id (required when `provider` is `external`)."
    )
    embedding_model: str | None = Field(
        default=None,
        description="Embedding model name. Use the `model` field from "
        "[Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`.",
    )
    embedding_model_provider: str | None = Field(
        default=None,
        description="Embedding model provider. Use the `provider` field from "
        "[Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`.",
    )
    retrieval_model: dict[str, Any] | None = Field(
        default=None, description="Retrieval model configuration as a JSON object."
    )

    @field_validator("retrieval_model", mode="before")
    @classmethod
    def _valid_retrieval_model(cls, value: object) -> object:
        if value is not None:
            _check_retrieval_model(value)
        return value

    @model_validator(mode="after")
    def _external_binding_required(self) -> Self:
        if self.provider == DatasetProvider.EXTERNAL and (
            not self.external_knowledge_api_id or not self.external_knowledge_id
        ):
            raise ValueError("external_knowledge_api_id and external_knowledge_id are required for external datasets")
        return self


class DatasetPartialMemberPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: UUIDStr


class DatasetUpdatePayload(BaseModel):
    """Patchable knowledge-base settings.

    Indexing settings are fixed after creation: `indexing_technique`,
    `embedding_model`, and `embedding_model_provider` rebuild the whole index, so
    they are absent here and rejected as unknown fields.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | SkipJsonSchema[None] = Field(
        default=None, min_length=1, max_length=40, description="Knowledge base name. Omit to keep the current name."
    )
    description: str | None = Field(default=None, max_length=dify_config.DATASET_DESCRIPTION_MAX_LENGTH)
    permission: DatasetPermission | None = None
    retrieval_model: dict[str, Any] | None = Field(
        default=None, description="Retrieval model configuration as a JSON object."
    )
    summary_index_setting: dict[str, Any] | None = Field(
        default=None, description="Summary index settings as a JSON object."
    )
    partial_member_list: list[DatasetPartialMemberPayload] | None = Field(
        default=None, description="Member ids granted access when `permission` is `partial_members`."
    )
    external_retrieval_model: dict[str, Any] | None = Field(
        default=None, description="Retrieval model configuration for external knowledge bases as a JSON object."
    )
    external_knowledge_id: str | SkipJsonSchema[None] = Field(
        default=None,
        min_length=1,
        description="External knowledge base id. Omit to keep the current binding.",
    )
    external_knowledge_api_id: str | SkipJsonSchema[None] = Field(
        default=None,
        min_length=1,
        description="External knowledge API id. Omit to keep the current binding.",
    )
    icon_info: dict[str, Any] | None = Field(default=None, description="Icon metadata as a JSON object.")

    @field_validator("name", "external_knowledge_id", "external_knowledge_api_id", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("omit this field to keep its current value; null is not allowed")
        return value

    @field_validator("retrieval_model", mode="before")
    @classmethod
    def _valid_retrieval_model(cls, value: object) -> object:
        if value is not None:
            _check_retrieval_model(value)
        return value


class DatasetListQuery(PageQuery):
    model_config = ConfigDict(extra="forbid")

    query: str = Field("", description="Words to match in the knowledge base name")


class DatasetResponse(BaseModel):
    id: str
    name: str
    description: str | None
    provider: str
    permission: str
    indexing_technique: str | None
    embedding_model: str | None
    embedding_model_provider: str | None
    retrieval_model: dict[str, Any] | None
    external_knowledge_api_id: str | None
    external_knowledge_id: str | None
    created_at: int
    updated_at: int


class DatasetDetailResponse(DatasetResponse):
    partial_member_list: list[str] | None = Field(
        default=None,
        description="Member IDs for a legacy partial-members knowledge base; null when not applicable.",
    )


class DatasetListResponse(PaginationEnvelope[DatasetResponse]):
    pass


class DocumentTextPayload(BaseModel):
    """Flat text-document settings shared by create-by-text and update-by-text."""

    process_rule: dict[str, Any] | None = Field(
        default=None, description="Processing rules for chunking as a JSON object."
    )
    doc_form: DocumentForm | None = Field(
        default=None,
        description="`text_model` for standard chunking, `hierarchical_model` for parent-child, "
        "`qa_model` for question-answer pairs. Defaults to the knowledge base's form.",
    )


class DocumentCreateByTextPayload(DocumentTextPayload):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, description="Document name.")
    text: str = Field(min_length=1, description="Document text content.")
    doc_language: str | None = Field(default=None, description="Language of the document.")
    indexing_technique: DatasetIndexingTechnique | None = Field(
        default=None,
        description="Required for the first document when the knowledge base has no technique; "
        "later documents inherit the knowledge base's.",
    )
    retrieval_model: dict[str, Any] | None = Field(default=None, description="Retrieval model configuration.")
    embedding_model: str | None = None
    embedding_model_provider: str | None = None

    @field_validator("retrieval_model", mode="before")
    @classmethod
    def _valid_retrieval_model(cls, value: object) -> object:
        if value is not None:
            _check_retrieval_model(value)
        return value


class DocumentUpdateByTextPayload(DocumentTextPayload):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, description="Document name.")
    text: str | None = Field(default=None, description="Document text content.")

    @model_validator(mode="after")
    def _requires_a_change(self) -> Self:
        if self.text is not None and self.name is None:
            raise ValueError("name is required when text is provided")
        if self.text is None and not self.name and self.process_rule is None:
            raise ValueError("provide at least one of text, name, or process_rule")
        return self


class DocumentResponse(BaseModel):
    id: str
    dataset_id: str
    name: str
    data_source_type: str | None
    display_status: DocumentDisplayStatus | None
    error: str | None
    enabled: bool
    archived: bool
    doc_form: str | None
    doc_language: str | None
    document_process_rule: dict[str, Any] | None
    created_at: int | None
    updated_at: int | None
    completed_at: int | None


class DocumentAndBatchResponse(BaseModel):
    document: DocumentResponse
    batch: str


class DocumentUpdateResponse(BaseModel):
    document: DocumentResponse


class DocumentListQuery(PageQuery):
    model_config = ConfigDict(extra="forbid")

    query: str = Field("", description="Words to match in the document name")


class DocumentListResponse(PaginationEnvelope[DocumentResponse]):
    pass


class DocumentBatchItem(BaseModel):
    id: str
    display_status: DocumentDisplayStatus | None
    error: str | None
    completed_segments: int | None
    total_segments: int | None


class DocumentIndexingStatusResponse(BaseModel):
    batch: str
    display_status: DocumentDisplayStatus
    error: str | None
    documents: list[DocumentBatchItem]
