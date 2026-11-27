import json
from dataclasses import asdict, replace
from datetime import datetime
from http import HTTPStatus
from typing import Literal, override
from uuid import UUID

from flask import Response, abort, request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, ValidationError, field_validator
from werkzeug.exceptions import UnprocessableEntity

from controllers.common.errors import ForbiddenError, InvalidArgumentError, PaidPlanRequiredError
from controllers.common.fields import BinaryFileResponse
from controllers.common.rbac import AgentId, RBACCheck, Workspace
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.apikey import (
    API_KEY_DELETE_ROLES,
    API_KEY_EDIT_ROLES,
    api_key_errors,
    app_api_key_create_errors,
)
from controllers.console.app.app import (
    APP_LIST_QUERY_ARRAY_FIELDS,
    AppListQuery,
)
from controllers.console.app.app import (
    AppDetailWithSite as GenericAppDetailWithSite,
)
from controllers.console.app.app import (
    AppPagination as GenericAppPagination,
)
from controllers.console.app.app import (
    AppPartial as GenericAppPartial,
)
from controllers.console.app.app import (
    UpdateAppPayload as GenericUpdateAppPayload,
)
from controllers.console.app.error import LogExportLimitReachedHTTPError, LogExportTaskNotCancelableHTTPError
from controllers.console.app.log_export_response import (
    log_export_file_response,
    log_export_status_email_preference,
    update_log_export_email_preference,
)
from controllers.console.app.response import app_detail_response
from controllers.console.error import ApiKeyLimitExceededHTTPError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    is_cloud_edition_billing_paid_plan,
    model_validate,
    rbac_permission_required,
    validate_request,
)
from extensions.ext_application_services import application_services
from fields.agent_fields import (
    AgentConfigDraftSummaryResponse,
    AgentConfigSnapshotDetailResponse,
    AgentConfigSnapshotListResponse,
    AgentConfigSnapshotRestoreResponse,
    AgentConfigSnapshotSummaryResponse,
    AgentInviteOptionsResponse,
    AgentLogListResponse,
    AgentLogMessageListResponse,
    AgentLogSourceListResponse,
    AgentPublishedReferenceResponse,
    AgentRosterListResponse,
    AgentStatisticSummaryEnvelopeResponse,
)
from fields.api_key_fields import ApiKeyItem, ApiKeyList
from fields.base import ResponseModel
from fields.log_export_fields import (
    LogExportEmailNotificationPayload,
    LogExportEmailNotificationResponse,
    LogExportEstimatedRows,
    LogExportProgressResponse,
    LogExportTaskResponse,
)
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.login import current_account_with_tenant
from machinery.context import RequestContext
from models.account import TenantAccountRole
from models.model import IconType
from services.agent.agent_app_contracts import (
    AgentAppCopy,
    AgentAppDetail,
    AgentAppListPage,
    AgentAppNameConflictError,
    AgentAppNotFoundError,
)
from services.agent.app_composer_store import (
    AgentComposerAgentMissingError,
    AgentComposerSnapshotMissingError,
    AgentPublicationChangedError,
    AgentPublicationHomeUnavailableError,
    AgentPublicationModelMissingError,
)
from services.agent.errors import (
    AgentAccessNotReadyError,
    AgentModelNotConfiguredError,
    AgentNameConflictError,
    AgentNotFoundError,
    AgentVersionConflictError,
    AgentVersionNotFoundError,
    InvalidComposerConfigError,
    PlaintextSecretNotAllowedError,
)
from services.agent.observability_contracts import (
    AgentLogExportFilters,
    AgentLogExportQuery,
    AgentLogQuery,
    AgentObservabilityNotFoundError,
    normalize_agent_log_export_source,
)
from services.agent.observability_contracts import AgentStatisticsQuery as AgentObservabilityStatisticsQuery
from services.agent.version_store import (
    AgentVersionPlanRequiredError,
    AgentVersionUnavailableError,
    VersionAgentNotFoundError,
)
from services.app_service import CreateAppParams
from services.entities.agent_entities import RosterListQuery
from services.entities.app_entities import AppListParams, UpdateAppParams
from services.entities.conversation_entities import ConsoleLogIdentitySource
from services.feature_service import FeatureService
from services.retention.agent.log_export_service import AgentLogExportTask
from services.retention.log_export_email import LogExportEmailState
from services.retention.log_export_task import (
    LogExportFileNotFoundError,
    LogExportIdentityLabel,
    LogExportKind,
    LogExportLimitReachedError,
    LogExportStatus,
    LogExportTaskNotCancelableError,
    LogExportTaskNotFoundError,
    LogExportTaskNotReadyError,
)

_EDIT_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})

AgentPublicationStatus = Literal["published", "drafts"]


class AgentInviteOptionsQuery(RosterListQuery):
    app_id: str | None = Field(default=None, description="Workflow app id for in-current-workflow markers")
    tag_ids: list[UUID] = Field(default_factory=list, description="Agent tag IDs; every selected tag must match")


class AgentAppListQuery(AppListQuery):
    publication_status: AgentPublicationStatus | None = Field(
        default=None,
        description="Filter by published or draft Agent configuration status",
    )


class AgentIdPath(BaseModel):
    agent_id: str


class AgentAppCreatePayload(BaseModel):
    name: str = Field(..., min_length=1, description="Agent name")
    description: str | None = Field(default=None, description="Agent description (max 400 chars)", max_length=400)
    role: str | None = Field(default=None, description="Agent role", max_length=255)
    icon_type: IconType | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


# Keep agent-app roster DTOs agent-specific instead of reusing the shared
# /apps response/request models. The roster surface needs Agent-only fields such
# as `role`, while the generic console/apps contracts must stay unchanged.
class AgentAppUpdatePayload(GenericUpdateAppPayload):
    role: str | None = Field(default=None, description="Agent role", max_length=255)

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


class AgentAppCopyPayload(BaseModel):
    name: str | None = Field(default=None, description="Name for the copied agent")
    description: str | None = Field(default=None, description="Description for the copied agent", max_length=400)
    role: str | None = Field(default=None, description="Role for the copied agent", max_length=255)
    icon_type: IconType | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


class AgentAppPublishedReferenceResponse(BaseModel):
    app_id: str
    app_name: str
    app_icon_type: str | None = None
    app_icon: str | None = None
    app_icon_background: str | None = None


class AgentLogMessagesQuery(BaseModel):
    """Read the messages of a log with the common Agent log query filters."""

    page: int = Field(default=1, ge=1, description="Page number")
    limit: int = Field(default=20, ge=1, le=100, description="Page size")
    keyword: str | None = Field(default=None, description="Search query, answer, or conversation name")
    status: str | None = Field(default=None, description="Deprecated single status filter")
    statuses: list[str] = Field(default_factory=list, description="Filter by one or more of success, failed, paused")
    source: str | None = Field(
        default=None,
        description="Deprecated single source filter",
    )
    sources: list[str] = Field(
        default_factory=list,
        description=(
            "Filter by one or more source IDs, e.g. webapp:<app_id> "
            "or workflow:<app_id>. Exact workflow:<app_id>:<workflow_id>:<version>:<node_id> IDs remain supported."
        ),
    )
    sort_by: str = Field(default="updated_at", description="Sort by created_at or updated_at")
    sort_order: str = Field(default="desc", description="Sort order: asc or desc")
    start: str | None = Field(default=None, description="Start date (YYYY-MM-DD HH:MM)")
    end: str | None = Field(default=None, description="End date (YYYY-MM-DD HH:MM)")

    @field_validator("keyword", "status", "source", "start", "end", mode="before")
    @classmethod
    def empty_string_to_none(cls, value: str | None) -> str | None:
        if value == "":
            return None
        return value

    @field_validator("statuses", "sources", mode="before")
    @classmethod
    def empty_list_values_to_list(cls, value: object) -> list[str]:
        if value in (None, ""):
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        raise ValueError("Unsupported query list type.")

    @field_validator("sort_by")
    @classmethod
    def validate_sort_by(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"created_at", "updated_at"}:
            raise ValueError("sort_by must be created_at or updated_at")
        return normalized

    @field_validator("sort_order")
    @classmethod
    def validate_sort_order(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"asc", "desc"}:
            raise ValueError("sort_order must be asc or desc")
        return normalized

    def to_query(self) -> AgentLogQuery:
        """Convert validated pagination, sorting and filters to the observability input."""
        return AgentLogQuery(
            page=self.page,
            limit=self.limit,
            keyword=self.keyword,
            statuses=tuple(self.statuses),
            sources=tuple(self.sources),
            sort_by=self.sort_by,
            sort_order=self.sort_order,
            start=self.start,
            end=self.end,
        )


class AgentLogsQuery(AgentLogMessagesQuery):
    """Add identity filters to the Agent log list query."""

    end_user_ids: list[UUID] = Field(default_factory=list, description="Include logs from these end users")
    account_ids: list[UUID] = Field(default_factory=list, description="Include logs from these workspace accounts")

    @override
    def to_query(self) -> AgentLogQuery:
        """Include the selected identities in the observability input for the log list."""
        return replace(
            super().to_query(),
            end_user_ids=tuple(str(end_user_id) for end_user_id in self.end_user_ids),
            account_ids=tuple(str(account_id) for account_id in self.account_ids),
        )


class AgentStatisticsQuery(BaseModel):
    source: str | None = Field(
        default=None,
        description=(
            "Filter by a structured webapp:<app_id> or workflow:<app_id> source ID. "
            "Legacy invoke sources and exact workflow version/node source IDs remain supported."
        ),
    )
    start: str | None = Field(default=None, description="Start date (YYYY-MM-DD HH:MM)")
    end: str | None = Field(default=None, description="End date (YYYY-MM-DD HH:MM)")

    @field_validator("source", "start", "end", mode="before")
    @classmethod
    def empty_string_to_none(cls, value: str | None) -> str | None:
        if value == "":
            return None
        return value


class AgentLogExportPreviewQuery(BaseModel):
    sources: list[str] = Field(default_factory=list, description="Source IDs from the Agent Logs filters")
    end_user_ids: list[UUID] = Field(default_factory=list, description="Include logs from these end users")
    account_ids: list[UUID] = Field(default_factory=list, description="Include logs from these workspace accounts")
    start: str | None = Field(
        default=None, description="Inclusive start time in the account timezone (YYYY-MM-DD HH:MM)"
    )
    end: str | None = Field(default=None, description="Exclusive end time in the account timezone (YYYY-MM-DD HH:MM)")

    @field_validator("sources")
    @classmethod
    def validate_source_ids(cls, sources: list[str]) -> list[str]:
        """Reject malformed structured source identifiers before querying UUID columns."""
        return [normalize_agent_log_export_source(source) for source in sources if source.strip()]

    def to_query(self) -> AgentLogExportQuery:
        """Pass validated filters and account-local date bounds to Agent log export."""
        return AgentLogExportQuery(
            sources=tuple(self.sources),
            end_user_ids=tuple(str(user_id) for user_id in self.end_user_ids),
            account_ids=tuple(str(account_id) for account_id in self.account_ids),
            start=self.start,
            end=self.end,
        )


class AgentLogExportCreatePayload(AgentLogExportPreviewQuery):
    """Submit unpaginated preview filters and their display labels for the export."""

    model_config = ConfigDict(extra="forbid")

    identity_labels: tuple[LogExportIdentityLabel, ...] = ()
    estimated_rows: LogExportEstimatedRows = None


class AgentLogIdentitySearchQuery(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    keyword: str = Field(min_length=1, max_length=255, description="Part of an identity label or a full internal ID")


class AgentLogIdentityOptionResponse(ResponseModel):
    id: str
    label: str
    source: ConsoleLogIdentitySource


class AgentLogIdentitySearchResponse(ResponseModel):
    data: list[AgentLogIdentityOptionResponse]


class AgentLogExportCountsResponse(ResponseModel):
    log_count: int
    row_count: int


class AgentLogExportPreviewResponse(ResponseModel):
    counts: AgentLogExportCountsResponse | None = Field(description="Matching log and CSV row counts, null on timeout")


class AgentLogExportTaskResponse(LogExportTaskResponse):
    status: Literal["pending"]


class AgentLogExportStatusResponse(LogExportTaskResponse):
    status: LogExportStatus
    progress: LogExportProgressResponse | None = None
    email_notification: LogExportEmailState | None = Field(default=None, exclude_if=lambda value: value is None)


class AgentLogExportLatestTaskResponse(AgentLogExportStatusResponse):
    filters: AgentLogExportFilters
    identity_labels: tuple[LogExportIdentityLabel, ...] = ()
    expires_at: datetime | None = Field(default=None, description="UTC deadline for downloading the export")


class AgentLogExportLatestResponse(ResponseModel):
    task: AgentLogExportLatestTaskResponse | None = Field(
        description="Null if the caller has no live export task for this Agent"
    )


class AgentLogExportTaskNotFoundHTTPError(BaseHTTPException):
    error_code = "agent_log_export_task_not_found"
    description = "Agent log export task not found."
    code = HTTPStatus.NOT_FOUND


class AgentLogExportTaskNotReadyHTTPError(BaseHTTPException):
    error_code = "agent_log_export_task_not_ready"
    description = "The Agent log export is not ready for download."
    code = HTTPStatus.CONFLICT


class AgentLogExportFileNotFoundHTTPError(BaseHTTPException):
    error_code = "agent_log_export_file_not_found"
    description = "Agent log export file not found."
    code = HTTPStatus.NOT_FOUND


class AgentAppPartial(GenericAppPartial):
    permission_keys: list[str]
    app_id: str | None = None
    backing_app_id: str | None = None
    hidden_app_backed: bool = False
    debug_conversation_id: str | None = None
    role: str | None = None
    active_config_is_published: bool = False
    reference_count: int | None = None
    published_reference_count: int = 0
    published_references: list[AgentAppPublishedReferenceResponse] = Field(default_factory=list)


class AgentAppDetailWithSite(GenericAppDetailWithSite):
    permission_keys: list[str]
    bound_agent_id: str | None = None
    app_id: str | None = None
    backing_app_id: str | None = None
    hidden_app_backed: bool = False
    debug_conversation_id: str | None = None
    debug_conversation_has_messages: bool = False
    debug_conversation_message_count: int = 0
    role: str | None = None
    access_ready: bool = False


class AgentPublishPayload(BaseModel):
    version_note: str | None = Field(default=None, description="Optional note for this published Agent version")


class AgentPublishResponse(ResponseModel):
    result: str
    publication_kind: Literal["first", "update"] = Field(
        description=(
            "Classifies the publication by whether the Agent had a publish-visible active snapshot before publishing: "
            "'first' if none existed, otherwise 'update'. This is not a historical first-publish indicator. "
            "It does not depend on draft edits, Web App or API enablement, or the requesting user's access permissions."
        )
    )
    active_config_snapshot_id: str
    active_config_snapshot: AgentConfigSnapshotSummaryResponse | None = None
    draft: AgentConfigDraftSummaryResponse | None = None


class AgentPublicationCountsResponse(ResponseModel):
    published: int = Field(
        ge=0,
        description="Published Agent Apps in the current list scope, excluding the publication status filter",
    )
    drafts: int = Field(
        ge=0,
        description="Draft Agent Apps in the current list scope, excluding the publication status filter",
    )


class AgentAppPagination(GenericAppPagination):
    publication_counts: AgentPublicationCountsResponse
    data: list[AgentAppPartial] = Field(  # type: ignore[assignment]  # pyrefly: ignore[bad-override-mutable-attribute]
        validation_alias=AliasChoices("items", "data")
    )


register_schema_models(
    console_ns,
    AgentAppCreatePayload,
    AgentAppUpdatePayload,
    AgentAppCopyPayload,
    AgentPublishPayload,
    AgentAppListQuery,
    AgentInviteOptionsQuery,
    AgentLogsQuery,
    AgentLogExportCreatePayload,
    LogExportEmailNotificationPayload,
    AgentStatisticsQuery,
    AgentIdPath,
    AppListQuery,
    RosterListQuery,
)
register_response_schema_models(
    console_ns,
    AgentPublicationCountsResponse,
    AgentAppPagination,
    AgentAppPublishedReferenceResponse,
    AgentAppDetailWithSite,
    AgentAppPartial,
    AgentPublishResponse,
    AgentConfigSnapshotDetailResponse,
    AgentConfigSnapshotListResponse,
    AgentConfigSnapshotRestoreResponse,
    AgentInviteOptionsResponse,
    AgentLogIdentitySearchResponse,
    AgentLogListResponse,
    AgentLogExportPreviewResponse,
    AgentLogExportTaskResponse,
    AgentLogExportStatusResponse,
    AgentLogExportLatestResponse,
    LogExportEmailNotificationResponse,
    BinaryFileResponse,
    AgentLogMessageListResponse,
    AgentLogSourceListResponse,
    AgentPublishedReferenceResponse,
    AgentRosterListResponse,
    AgentStatisticSummaryEnvelopeResponse,
)


def _agent_app_detail_response(detail: AgentAppDetail) -> dict[str, object]:
    """Render detached App and Agent details using the existing Console response schema."""
    payload = app_detail_response(detail.app).model_dump(mode="json")
    payload.update(
        id=detail.agent_id,
        app_id=detail.app_id,
        backing_app_id=detail.backing_app_id,
        hidden_app_backed=detail.hidden_app_backed,
        debug_conversation_id=detail.debug_conversation_id,
        debug_conversation_has_messages=detail.debug_conversation_message_count > 0,
        debug_conversation_message_count=detail.debug_conversation_message_count,
        role=detail.role,
        access_ready=detail.access_ready,
    )
    return AgentAppDetailWithSite.model_validate(payload).model_dump(mode="json", exclude={"bound_agent_id"})


def _agent_app_list_response(page: AgentAppListPage) -> dict[str, object]:
    """Render detached App records with their Agent-specific list fields."""
    payload = GenericAppPagination.model_validate(
        {
            "page": page.page,
            "limit": page.limit,
            "total": page.total,
            "has_more": page.has_more,
            "data": [item.app for item in page.data],
        }
    ).model_dump(mode="json")
    payload["publication_counts"] = {
        "published": page.publication_counts.published,
        "drafts": page.publication_counts.drafts,
    }
    for item, record in zip(payload["data"], page.data, strict=True):
        item.pop("bound_agent_id", None)
        if record.agent_id:
            item.update(
                app_id=record.app.id,
                backing_app_id=record.backing_app_id,
                hidden_app_backed=False,
                id=record.agent_id,
                debug_conversation_id=record.debug_conversation_id,
                permission_keys=record.permission_keys,
                role=record.role,
                active_config_is_published=record.active_config_is_published,
                reference_count=record.reference_count,
                published_reference_count=len(record.published_references),
                published_references=[
                    {
                        key: reference[key]
                        for key in ("app_id", "app_name", "app_icon_type", "app_icon", "app_icon_background")
                    }
                    for reference in record.published_references
                ],
            )
    return AgentAppPagination.model_validate(payload).model_dump(
        mode="json", exclude={"data": {"__all__": {"bound_agent_id"}}}
    )


def _query_values(name: str, alias_name: str | None = None) -> list[str]:
    def _get_values(field_name: str) -> list[str]:
        values = request.args.getlist(field_name)
        indexed_values: list[tuple[int, list[str]]] = []
        prefix = f"{field_name}["
        for key in request.args:
            if not key.startswith(prefix) or not key.endswith("]"):
                continue
            index = key[len(prefix) : -1]
            if index.isdigit():
                indexed_values.append((int(index), request.args.getlist(key)))
        for _, items in sorted(indexed_values):
            values.extend(items)
        return values

    values = _get_values(name)
    if alias_name:
        values.extend(_get_values(alias_name))
    return [value.strip() for value in values if value.strip()]


@console_ns.route("/agent")
class AgentAppListApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.doc(params=query_params_from_model(AgentAppListQuery))
    @console_ns.response(HTTPStatus.OK, "Agent app list", console_ns.models[AgentAppPagination.__name__])
    @console_account_admission()
    def get(self, context: RequestContext) -> dict[str, object]:
        args = query_params_from_request(AgentAppListQuery, list_fields=APP_LIST_QUERY_ARRAY_FIELDS)
        params = AppListParams(
            page=args.page,
            limit=args.limit,
            mode="agent",
            sort_by=args.sort_by,
            name=args.name,
            tag_ids=args.tag_ids,
            creator_ids=args.creator_ids,
            is_created_by_me=args.is_created_by_me,
            status="normal",
            agent_is_published=None if args.publication_status is None else args.publication_status == "published",
        )
        return _agent_app_list_response(application_services().agent_apps.collection.list_apps(context, params))

    @error_responses(AgentNameConflictError, AgentNotFoundError)
    @console_ns.expect(console_ns.models[AgentAppCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED, "Agent app created successfully", console_ns.models[AgentAppDetailWithSite.__name__]
    )
    @console_ns.response(HTTPStatus.CONFLICT, "Agent name already exists")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid request parameters")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.AGENT_CREATE, Workspace())],
    )
    @model_validate(AgentAppCreatePayload)
    def post(self, req_data: AgentAppCreatePayload, context: RequestContext) -> tuple[dict[str, object], int]:
        params = CreateAppParams(
            name=req_data.name,
            description=req_data.description,
            mode="agent",
            agent_role=req_data.role or "",
            icon_type=req_data.icon_type,
            icon=req_data.icon,
            icon_background=req_data.icon_background,
        )
        try:
            detail = application_services().agent_apps.collection.create(context, params)
        except AgentAppNotFoundError as exc:
            raise AgentNotFoundError from exc
        except AgentAppNameConflictError as exc:
            raise AgentNameConflictError from exc
        return _agent_app_detail_response(detail), HTTPStatus.CREATED


@console_ns.route("/agent/<uuid:agent_id>")
class AgentAppApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.response(HTTPStatus.OK, "Agent app detail", console_ns.models[AgentAppDetailWithSite.__name__])
    @console_account_admission(
        require_valid_enterprise_license=True,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId())],
    )
    def get(self, request_context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Return the admitted Agent's detail and its Build conversation."""
        try:
            detail = application_services().agent_apps.detail.get(request_context, str(agent_id))
        except AgentAppNotFoundError as exc:
            raise AgentNotFoundError from exc
        return _agent_app_detail_response(detail)

    @error_responses(AgentNameConflictError, AgentNotFoundError)
    @console_ns.expect(console_ns.models[AgentAppUpdatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Agent app updated successfully", console_ns.models[AgentAppDetailWithSite.__name__]
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid request parameters")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())],
    )
    @model_validate(AgentAppUpdatePayload)
    def put(
        self,
        req_data: AgentAppUpdatePayload,
        request_context: RequestContext,
        agent_id: UUID,
    ) -> dict[str, object]:
        """Update a roster Agent App and return its current detail."""
        params = UpdateAppParams(
            name=req_data.name,
            description=req_data.description or "",
            icon_type=req_data.icon_type,
            icon=req_data.icon or "",
            icon_background=req_data.icon_background or "",
            use_icon_as_answer_icon=req_data.use_icon_as_answer_icon or False,
            max_active_requests=req_data.max_active_requests or 0,
            role=req_data.role,
        )
        try:
            detail = application_services().agent_apps.detail.update(request_context, str(agent_id), params)
        except AgentAppNotFoundError as exc:
            raise AgentNotFoundError from exc
        except AgentAppNameConflictError as exc:
            raise AgentNameConflictError from exc
        return _agent_app_detail_response(detail)

    @error_responses(AgentNotFoundError)
    @console_ns.response(HTTPStatus.NO_CONTENT, "Agent app deleted successfully")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.AGENT_DELETE, AgentId())],
    )
    def delete(self, request_context: RequestContext, agent_id: UUID) -> tuple[str, int]:
        """Delete an Agent App and schedule its resource cleanup."""
        try:
            application_services().agent_apps.lifecycle.delete(request_context, str(agent_id))
        except AgentAppNotFoundError as exc:
            raise AgentNotFoundError from exc
        return "", HTTPStatus.NO_CONTENT


@console_ns.route("/agent/<uuid:agent_id>/publish")
class AgentPublishApi(Resource):
    @error_responses(
        AgentModelNotConfiguredError,
        AgentNotFoundError,
        AgentVersionConflictError,
        AgentVersionNotFoundError,
        InvalidComposerConfigError,
        PlaintextSecretNotAllowedError,
    )
    @console_ns.expect(console_ns.models[AgentPublishPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Agent draft published", console_ns.models[AgentPublishResponse.__name__])
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_RELEASE_AND_VERSION, AgentId())],
    )
    @model_validate(AgentPublishPayload)
    def post(self, req_data: AgentPublishPayload, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Publish the current shared draft and return the committed version and draft metadata."""
        try:
            published = application_services().agent_apps.composer.publish(
                context, str(agent_id), req_data.version_note
            )
        except AgentComposerAgentMissingError as exc:
            raise AgentNotFoundError from exc
        except AgentComposerSnapshotMissingError as exc:
            raise AgentVersionNotFoundError from exc
        except AgentPublicationModelMissingError as exc:
            raise AgentModelNotConfiguredError from exc
        except AgentPublicationChangedError as exc:
            raise AgentVersionConflictError from exc
        except AgentPublicationHomeUnavailableError as exc:
            raise InvalidComposerConfigError("The Agent draft Home snapshot is unavailable.") from exc
        # The publish endpoint emits the sparse snapshot summary used before the Composer refactor.
        return dict(asdict(published))


@console_ns.route("/agent/<uuid:agent_id>/copy")
class AgentAppCopyApi(Resource):
    @error_responses(AgentNameConflictError, AgentNotFoundError, AgentVersionNotFoundError)
    @console_ns.expect(console_ns.models[AgentAppCopyPayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED, "Agent app copied successfully", console_ns.models[AgentAppDetailWithSite.__name__]
    )
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid request parameters")
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_CREATE, Workspace())],
    )
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId()))
    @model_validate(AgentAppCopyPayload)
    def post(
        self, req_data: AgentAppCopyPayload, context: RequestContext, agent_id: UUID
    ) -> tuple[dict[str, object], HTTPStatus]:
        """Copy an admitted roster Agent App and render its committed private detail."""
        try:
            detail = application_services().agent_apps.collection.copy(
                context,
                str(agent_id),
                AgentAppCopy(
                    name=req_data.name,
                    description=req_data.description,
                    role=req_data.role,
                    icon_type=req_data.icon_type,
                    icon=req_data.icon,
                    icon_background=req_data.icon_background,
                ),
            )
        except AgentAppNameConflictError as exc:
            raise AgentNameConflictError from exc
        except AgentAppNotFoundError as exc:
            raise AgentNotFoundError from exc
        except AgentComposerSnapshotMissingError as exc:
            raise AgentVersionNotFoundError from exc
        return _agent_app_detail_response(detail), HTTPStatus.CREATED


@console_ns.route("/agent/<uuid:agent_id>/api-keys")
class AgentApiKeyListApi(Resource):
    @console_ns.response(200, "Agent service API keys", console_ns.models[ApiKeyList.__name__])
    @console_account_admission(
        allowed_roles=API_KEY_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_ACCESS_POINT_VIEW, AgentId())],
    )
    def get(self, request_context: RequestContext, agent_id: UUID) -> dict[str, object]:
        with api_key_errors():
            keys = application_services().app_api_keys.list_agent_keys(request_context, str(agent_id))
        return dump_response(ApiKeyList, {"data": keys})

    @error_responses(AgentAccessNotReadyError, ApiKeyLimitExceededHTTPError)
    @console_ns.response(201, "Agent service API key created", console_ns.models[ApiKeyItem.__name__])
    @console_ns.response(400, "Maximum keys exceeded")
    @console_account_admission(
        allowed_roles=API_KEY_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentId())],
    )
    def post(self, request_context: RequestContext, agent_id: UUID) -> tuple[dict[str, object], int]:
        with app_api_key_create_errors():
            key = application_services().app_api_keys.create_agent_key(request_context, str(agent_id))
        return dump_response(ApiKeyItem, key), 201


@console_ns.route("/agent/<uuid:agent_id>/api-keys/<uuid:api_key_id>")
class AgentApiKeyApi(Resource):
    @console_ns.response(204, "Agent service API key deleted")
    @console_account_admission(
        allowed_roles=API_KEY_DELETE_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentId())],
    )
    def delete(
        self,
        request_context: RequestContext,
        agent_id: UUID,
        api_key_id: UUID,
    ) -> tuple[str, int]:
        with api_key_errors():
            application_services().app_api_keys.delete_agent_key(request_context, str(agent_id), str(api_key_id))
        return "", 204


@console_ns.route("/agent/invite-options")
class AgentInviteOptionsApi(Resource):
    @console_ns.doc(params=query_params_from_model(AgentInviteOptionsQuery))
    @console_ns.response(HTTPStatus.OK, "Agent invite options", console_ns.models[AgentInviteOptionsResponse.__name__])
    @console_account_admission()
    def get(
        self,
        context: RequestContext,
    ) -> dict[str, object]:
        """Return visible Workflow-callable Agents matching validated tag filters.

        Preconditions: Console admission supplies the active workspace identity.
        Postconditions: repeated tag_ids are validated as UUIDs and passed with
        name/pagination filters; the response contains detached Agent tags.
        """
        try:
            req_data = query_params_from_request(AgentInviteOptionsQuery, list_fields=("tag_ids",))
        except ValidationError as exc:
            # Preserve this endpoint's existing @model_validate 422 contract
            # while parsing repeated tag IDs without exposing submitted values.
            errors = exc.errors(include_url=False, include_input=False, include_context=False)
            raise UnprocessableEntity(json.dumps(errors)) from None
        return dump_response(
            AgentInviteOptionsResponse,
            application_services().agent_invite_options.list(
                context,
                page=req_data.page,
                limit=req_data.limit,
                keyword=req_data.keyword,
                app_id=req_data.app_id,
                tag_ids=tuple(str(tag_id) for tag_id in req_data.tag_ids),
            ),
        )


def _agent_log_query(model: type[AgentLogMessagesQuery]) -> AgentLogQuery:
    """Parse repeated and indexed query parameters admitted by the list or detail schema."""
    query_data: dict[str, object] = dict(request.args.to_dict(flat=True))
    query_data["sources"] = _query_values("sources", "source")
    query_data["statuses"] = _query_values("statuses", "status")
    if issubclass(model, AgentLogsQuery):
        query_data["end_user_ids"] = _query_values("end_user_ids")
        query_data["account_ids"] = _query_values("account_ids")
    return model.model_validate(query_data).to_query()


@console_ns.route("/agent/<uuid:agent_id>/logs")
class AgentLogsApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.doc(params=query_params_from_model(AgentLogsQuery))
    @console_ns.response(HTTPStatus.OK, "Agent logs", console_ns.models[AgentLogListResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Return the admitted Agent's conversation logs."""
        query = _agent_log_query(AgentLogsQuery)
        try:
            payload = application_services().agent_observability.list_logs(context, str(agent_id), query)
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc
        except ValueError as exc:
            abort(HTTPStatus.BAD_REQUEST, description=str(exc))
        return dump_response(AgentLogListResponse, payload)


@console_ns.route("/agent/<uuid:agent_id>/logs/identity-options")
class AgentLogIdentityOptionsApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.doc("search_agent_log_identities", params=query_params_from_model(AgentLogIdentitySearchQuery))
    @console_ns.response(
        HTTPStatus.OK, "Matching identities", console_ns.models[AgentLogIdentitySearchResponse.__name__]
    )
    @console_ns.response(HTTPStatus.UNPROCESSABLE_ENTITY, "Invalid keyword")
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Return matching identities with visible logs in the admitted Agent's WebApp or Workflow sources."""
        query = validate_request(AgentLogIdentitySearchQuery)
        try:
            matches = application_services().agent_observability.search_log_identities(
                context, str(agent_id), keyword=query.keyword
            )
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc
        return dump_response(AgentLogIdentitySearchResponse, {"data": matches})


def _require_agent_log_export_access(context: RequestContext) -> None:
    """Require a workspace Owner or Admin with the Cloud log export entitlement when applicable."""
    if not TenantAccountRole.is_privileged_role(current_account_with_tenant().account.role):
        raise ForbiddenError()
    if FeatureService.requires_paid_plan_for_log_export() and not is_cloud_edition_billing_paid_plan(
        context.active_workspace_id
    ):
        raise PaidPlanRequiredError()


@console_ns.route("/agent/<uuid:agent_id>/log-exports/preview")
class AgentLogExportPreviewApi(Resource):
    @error_responses(AgentNotFoundError, ForbiddenError, PaidPlanRequiredError, InvalidArgumentError)
    @console_ns.doc("preview_agent_log_export", params=query_params_from_model(AgentLogExportPreviewQuery))
    @console_ns.response(HTTPStatus.OK, "Export preview", console_ns.models[AgentLogExportPreviewResponse.__name__])
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid log filters")
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Return filtered export counts for the admitted Agent, workspace role, and plan."""
        _require_agent_log_export_access(context)
        try:
            query = AgentLogExportPreviewQuery.model_validate(
                {
                    "sources": _query_values("sources"),
                    "end_user_ids": _query_values("end_user_ids"),
                    "account_ids": _query_values("account_ids"),
                    "start": request.args.get("start"),
                    "end": request.args.get("end"),
                }
            )
            counts = application_services().agent_observability.count_export_logs(
                context, str(agent_id), query.to_query()
            )
        except ValidationError as exc:
            raise InvalidArgumentError(
                exc.json(include_url=False, include_input=False, include_context=False)
            ) from None
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc
        except ValueError as exc:
            raise InvalidArgumentError(str(exc)) from exc
        return dump_response(AgentLogExportPreviewResponse, {"counts": counts})


@console_ns.route("/agent/<uuid:agent_id>/log-exports")
class AgentLogExportApi(Resource):
    @error_responses(
        AgentNotFoundError, ForbiddenError, PaidPlanRequiredError, InvalidArgumentError, LogExportLimitReachedHTTPError
    )
    @console_ns.doc("create_agent_log_export", description="Create a pending CSV export task for the Agent")
    @console_ns.expect(console_ns.models[AgentLogExportCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.ACCEPTED, "Export task created", console_ns.models[AgentLogExportTaskResponse.__name__]
    )
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid log filters")
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def post(self, context: RequestContext, agent_id: UUID) -> tuple[dict[str, object], HTTPStatus]:
        """Admit the caller and return the Agent's task ID after the normalized filters are saved."""
        _require_agent_log_export_access(context)
        try:
            payload = AgentLogExportCreatePayload.model_validate(request.get_json(silent=True))
            task = application_services().agent_log_exports.create_task(
                context,
                str(agent_id),
                payload.to_query(),
                identity_labels=payload.identity_labels,
                estimated_rows=payload.estimated_rows,
            )
        except ValidationError as exc:
            raise InvalidArgumentError(
                exc.json(include_url=False, include_input=False, include_context=False)
            ) from None
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc
        except LogExportLimitReachedError as exc:
            raise LogExportLimitReachedHTTPError() from exc
        except ValueError as exc:
            raise InvalidArgumentError(str(exc)) from exc
        return dump_response(AgentLogExportTaskResponse, task), HTTPStatus.ACCEPTED


@console_ns.route("/agent/<uuid:agent_id>/log-exports/latest")
class AgentLogExportLatestApi(Resource):
    @error_responses(AgentNotFoundError, ForbiddenError, PaidPlanRequiredError)
    @console_ns.doc(
        "get_latest_agent_log_export", description="Get the caller's latest Agent log export and its filters"
    )
    @console_ns.response(HTTPStatus.OK, "Latest export", console_ns.models[AgentLogExportLatestResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> tuple[dict[str, object], HTTPStatus, dict[str, str]]:
        """Return the caller's latest live task for an available Agent, or a null task."""
        _require_agent_log_export_access(context)
        try:
            task = application_services().agent_log_exports.get_latest_task(context, str(agent_id))
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc
        return dump_response(AgentLogExportLatestResponse, {"task": task}), HTTPStatus.OK, {"Cache-Control": "no-store"}


@console_ns.route("/agent/<uuid:agent_id>/log-exports/<uuid:task_id>")
class AgentLogExportTaskApi(Resource):
    @staticmethod
    def _get_task(context: RequestContext, agent_id: UUID, task_id: UUID) -> AgentLogExportTask:
        """Load the live export after checking the caller's access to the selected Agent."""
        _require_agent_log_export_access(context)
        try:
            return application_services().agent_log_exports.get_task(context, str(agent_id), task_id=str(task_id))
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc

    @error_responses(AgentNotFoundError, AgentLogExportTaskNotFoundHTTPError, ForbiddenError, PaidPlanRequiredError)
    @console_ns.doc("get_agent_log_export_status", description="Get the current status of an Agent log export task")
    @console_ns.response(HTTPStatus.OK, "Export task status", console_ns.models[AgentLogExportStatusResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def get(
        self, context: RequestContext, agent_id: UUID, task_id: UUID
    ) -> tuple[dict[str, object], HTTPStatus, dict[str, str]]:
        """Return the state of a live task scoped to the admitted workspace and Agent."""
        try:
            task = self._get_task(context, agent_id, task_id)
        except LogExportTaskNotFoundError as exc:
            raise AgentLogExportTaskNotFoundHTTPError() from exc
        return (
            dump_response(AgentLogExportStatusResponse, task)
            | log_export_status_email_preference(task, account_id=context.account_id, export_kind=LogExportKind.AGENT),
            HTTPStatus.OK,
            {"Cache-Control": "no-store"},
        )

    @error_responses(AgentNotFoundError, AgentLogExportTaskNotFoundHTTPError, ForbiddenError, PaidPlanRequiredError)
    @console_ns.doc("set_agent_log_export_email_notification")
    @console_ns.doc(description="Set the requester's email preference for this Agent CSV export")
    @console_ns.expect(console_ns.models[LogExportEmailNotificationPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Email notification preference", console_ns.models[LogExportEmailNotificationResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    @model_validate(LogExportEmailNotificationPayload)
    def put(
        self, payload: LogExportEmailNotificationPayload, context: RequestContext, agent_id: UUID, task_id: UUID
    ) -> tuple[dict[str, object], HTTPStatus, dict[str, str]]:
        """Update the caller's preference for a live export of the Agent's logs."""
        try:
            task = self._get_task(context, agent_id, task_id)
            return update_log_export_email_preference(
                task, account_id=context.account_id, export_kind=LogExportKind.AGENT, enabled=payload.enabled
            )
        except LogExportTaskNotFoundError as exc:
            raise AgentLogExportTaskNotFoundHTTPError() from exc


@console_ns.route("/agent/<uuid:agent_id>/log-exports/<uuid:task_id>/cancel")
class AgentLogExportCancelApi(Resource):
    @error_responses(
        AgentNotFoundError,
        AgentLogExportTaskNotFoundHTTPError,
        LogExportTaskNotCancelableHTTPError,
        ForbiddenError,
        PaidPlanRequiredError,
    )
    @console_ns.doc("cancel_agent_log_export", description="Cancel a queued Agent CSV export task")
    @console_ns.response(HTTPStatus.OK, "Export canceled", console_ns.models[AgentLogExportStatusResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def post(
        self, context: RequestContext, agent_id: UUID, task_id: UUID
    ) -> tuple[dict[str, object], HTTPStatus, dict[str, str]]:
        """Cancel the admitted requester's queued Agent task and return its new status."""
        _require_agent_log_export_access(context)
        try:
            task = application_services().agent_log_exports.cancel_task(context, str(agent_id), task_id=str(task_id))
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc
        except LogExportTaskNotFoundError as exc:
            raise AgentLogExportTaskNotFoundHTTPError() from exc
        except LogExportTaskNotCancelableError as exc:
            raise LogExportTaskNotCancelableHTTPError() from exc
        return dump_response(AgentLogExportStatusResponse, task), HTTPStatus.OK, {"Cache-Control": "no-store"}


@console_ns.route("/agent/<uuid:agent_id>/log-exports/<uuid:task_id>/file")
class AgentLogExportFileApi(Resource):
    @error_responses(
        AgentNotFoundError,
        AgentLogExportTaskNotFoundHTTPError,
        AgentLogExportTaskNotReadyHTTPError,
        AgentLogExportFileNotFoundHTTPError,
        ForbiddenError,
        PaidPlanRequiredError,
    )
    @console_ns.doc("download_agent_log_export")
    @console_ns.doc(description="Download a completed Agent log CSV from object storage or the Console API")
    @console_ns.doc(params={"agent_id": "Agent ID", "task_id": "Export task ID"})
    @console_ns.produces(["text/csv"])
    @console_ns.response(HTTPStatus.OK, "CSV attachment", console_ns.models[BinaryFileResponse.__name__])
    @console_ns.response(
        HTTPStatus.FOUND,
        "Redirect to a pre-signed CSV download URL",
        headers={"Location": {"description": "Pre-signed object storage URL", "type": "string"}},
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, task_id: UUID) -> Response:
        """Authorize the Agent and its ready export before redirecting or streaming the CSV."""
        _require_agent_log_export_access(context)
        filename = f"agent-logs-{task_id}.csv"
        try:
            download = application_services().agent_log_exports.download_csv(
                context, str(agent_id), task_id=str(task_id), filename=filename
            )
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc
        except LogExportTaskNotFoundError as exc:
            raise AgentLogExportTaskNotFoundHTTPError() from exc
        except LogExportTaskNotReadyError as exc:
            raise AgentLogExportTaskNotReadyHTTPError() from exc
        except LogExportFileNotFoundError as exc:
            raise AgentLogExportFileNotFoundHTTPError() from exc
        # response-contract:ignore signed redirect or streamed CSV attachment
        return log_export_file_response(download, filename=filename)


@console_ns.route("/agent/<uuid:agent_id>/logs/<uuid:conversation_id>/messages")
class AgentLogMessagesApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.doc(params=query_params_from_model(AgentLogMessagesQuery))
    @console_ns.response(HTTPStatus.OK, "Agent log messages", console_ns.models[AgentLogMessageListResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, conversation_id: UUID) -> dict[str, object]:
        """Return the admitted Agent's messages for a conversation."""
        query = _agent_log_query(AgentLogMessagesQuery)
        try:
            payload = application_services().agent_observability.list_log_messages(
                context, str(agent_id), str(conversation_id), query
            )
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc
        except ValueError as exc:
            abort(HTTPStatus.BAD_REQUEST, description=str(exc))
        return dump_response(AgentLogMessageListResponse, payload)


@console_ns.route("/agent/<uuid:agent_id>/log-sources")
class AgentLogSourcesApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.response(HTTPStatus.OK, "Agent log sources", console_ns.models[AgentLogSourceListResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Return the admitted Agent's available log sources."""
        try:
            payload = application_services().agent_observability.list_log_sources(context, str(agent_id))
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc
        return dump_response(AgentLogSourceListResponse, payload)


@console_ns.route("/agent/<uuid:agent_id>/statistics/summary")
class AgentStatisticsSummaryApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.doc(params=query_params_from_model(AgentStatisticsQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "Agent monitoring summary and chart data",
        console_ns.models[AgentStatisticSummaryEnvelopeResponse.__name__],
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_MONITOR, AgentId())])
    @model_validate(AgentStatisticsQuery)
    def get(self, req_data: AgentStatisticsQuery, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Return Agent monitoring data using the admitted account's timezone."""
        try:
            payload = application_services().agent_observability.statistics(
                context,
                str(agent_id),
                AgentObservabilityStatisticsQuery(source=req_data.source, start=req_data.start, end=req_data.end),
            )
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc
        except ValueError as exc:
            abort(HTTPStatus.BAD_REQUEST, description=str(exc))
        return dump_response(AgentStatisticSummaryEnvelopeResponse, payload)


@console_ns.route("/agent/<uuid:agent_id>/versions")
class AgentRosterVersionsApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.response(HTTPStatus.OK, "Agent versions", console_ns.models[AgentConfigSnapshotListResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_RELEASE_AND_VERSION, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        try:
            versions = application_services().agent_versions.list_versions(context, str(agent_id))
        except VersionAgentNotFoundError as exc:
            raise AgentNotFoundError from exc
        return dump_response(AgentConfigSnapshotListResponse, {"data": versions})


@console_ns.route("/agent/<uuid:agent_id>/versions/<uuid:version_id>")
class AgentRosterVersionDetailApi(Resource):
    @error_responses(AgentNotFoundError, AgentVersionNotFoundError)
    @console_ns.response(
        HTTPStatus.OK, "Agent version detail", console_ns.models[AgentConfigSnapshotDetailResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_RELEASE_AND_VERSION, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, version_id: UUID) -> dict[str, object]:
        try:
            version = application_services().agent_versions.get_version(context, str(agent_id), str(version_id))
        except VersionAgentNotFoundError as exc:
            raise AgentNotFoundError from exc
        except AgentVersionUnavailableError as exc:
            raise AgentVersionNotFoundError from exc
        return dump_response(AgentConfigSnapshotDetailResponse, version)


@console_ns.route("/agent/<uuid:agent_id>/versions/<uuid:version_id>/restore")
class AgentRosterVersionRestoreApi(Resource):
    @error_responses(AgentNotFoundError, AgentVersionNotFoundError)
    @console_ns.response(
        HTTPStatus.OK, "Agent version restored", console_ns.models[AgentConfigSnapshotRestoreResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.AGENT_RELEASE_AND_VERSION, AgentId())],
    )
    def post(self, context: RequestContext, agent_id: UUID, version_id: UUID) -> dict[str, object]:
        try:
            restored = application_services().agent_versions.restore_version(context, str(agent_id), str(version_id))
        except VersionAgentNotFoundError as exc:
            raise AgentNotFoundError from exc
        except AgentVersionUnavailableError as exc:
            raise AgentVersionNotFoundError from exc
        except AgentVersionPlanRequiredError:
            abort(HTTPStatus.FORBIDDEN, description="This feature requires a paid plan.")
        return dump_response(AgentConfigSnapshotRestoreResponse, restored)
