from http import HTTPStatus
from typing import Literal
from uuid import UUID

from flask import abort, request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.common.rbac import AgentId, RBACCheck, Workspace
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.common.session import with_session
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
from controllers.console.app.response import app_detail_response
from controllers.console.error import ApiKeyLimitExceededHTTPError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    account_initialization_required,
    edit_permission_required,
    model_validate,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
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
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.login import login_required
from machinery.context import RequestContext
from models import Account
from models.account import TenantAccountRole
from models.agent import Agent, AgentStatus
from models.agent_config_entities import AgentSoulConfig
from models.model import App, IconType
from services.agent.composer_service import AgentComposerService
from services.agent.errors import (
    AgentAccessNotReadyError,
    AgentBuildSandboxNotFoundError,
    AgentHomeSnapshotCreateFailedError,
    AgentHomeSnapshotTooLargeError,
    AgentModelNotConfiguredError,
    AgentNameConflictError,
    AgentNotFoundError,
    AgentSoulLockedError,
    AgentVersionNotFoundError,
    InvalidComposerConfigError,
    PlaintextSecretNotAllowedError,
)
from services.agent.observability_contracts import AgentLogQuery, AgentObservabilityNotFoundError
from services.agent.observability_contracts import AgentStatisticsQuery as AgentObservabilityStatisticsQuery
from services.agent.roster_service import AgentRosterService
from services.agent.version_store import (
    AgentVersionPlanRequiredError,
    AgentVersionUnavailableError,
    VersionAgentNotFoundError,
)
from services.app.agent_app_contracts import (
    AgentAppDetail,
    AgentAppListPage,
    AgentAppNameConflictError,
    AgentAppNotFoundError,
)
from services.app_service import AppResponseView, CreateAppParams
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.agent_entities import ComposerSavePayload, RosterListQuery
from services.entities.app_entities import AppListParams, UpdateAppParams
from services.system_feature_service import SystemFeatureService

AgentPublicationStatus = Literal["published", "drafts"]


class AgentInviteOptionsQuery(RosterListQuery):
    app_id: str | None = Field(default=None, description="Workflow app id for in-current-workflow markers")


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


class AgentLogsQuery(BaseModel):
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


class AgentDebugConversationRefreshResponse(BaseModel):
    debug_conversation_id: str
    debug_conversation_has_messages: bool = False
    debug_conversation_message_count: int = 0


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


class AgentBuildDraftCheckoutPayload(BaseModel):
    force: bool = Field(default=False, description="Overwrite the existing current-user build draft")


class AgentBuildDraftResponse(ResponseModel):
    variant: str
    draft: AgentConfigDraftSummaryResponse
    agent_soul: AgentSoulConfig


class AgentBuildDraftApplyResponse(BaseModel):
    result: str
    draft: dict[str, object]


class AgentSimpleResultResponse(BaseModel):
    result: str


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
    AgentBuildDraftCheckoutPayload,
    ComposerSavePayload,
    AgentAppListQuery,
    AgentInviteOptionsQuery,
    AgentLogsQuery,
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
    AgentDebugConversationRefreshResponse,
    AgentPublishResponse,
    AgentBuildDraftResponse,
    AgentBuildDraftApplyResponse,
    AgentSimpleResultResponse,
    AgentConfigSnapshotDetailResponse,
    AgentConfigSnapshotListResponse,
    AgentConfigSnapshotRestoreResponse,
    AgentInviteOptionsResponse,
    AgentLogListResponse,
    AgentLogMessageListResponse,
    AgentLogSourceListResponse,
    AgentPublishedReferenceResponse,
    AgentRosterListResponse,
    AgentStatisticSummaryEnvelopeResponse,
)


def _agent_roster_service(session: Session) -> AgentRosterService:
    return AgentRosterService(session)


def _serialize_agent_app_detail(
    session: Session, app_model, *, current_user: Account, agent_id: str | None = None
) -> dict:
    """Serialize an Agent App detail using roster-only DTOs.

    `/agent` responses are roster-shaped rather than raw app-shaped: `id`
    becomes the backing roster Agent id, `app_id` carries the underlying App
    id, and `role` is injected from the backing roster Agent. Keeping that
    remap in this serializer lets generated console/agent contracts expose the
    roster persona fields without widening the shared /apps detail schema.
    """

    access_mode = None
    if SystemFeatureService.is_webapp_auth_enabled():
        app_setting = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=str(app_model.id))
        access_mode = app_setting.access_mode

    roster_service = _agent_roster_service(session)
    payload = GenericAppDetailWithSite.model_validate(
        AppResponseView(app_model, session=session, account=current_user, access_mode=access_mode),
        from_attributes=True,
    ).model_dump(mode="json")
    agent = (
        session.scalar(
            select(Agent).where(
                Agent.tenant_id == app_model.tenant_id,
                Agent.id == agent_id,
                Agent.status == AgentStatus.ACTIVE,
            )
        )
        if agent_id
        else roster_service.get_app_backing_agent(tenant_id=app_model.tenant_id, app_id=str(app_model.id))
    )
    if not agent:
        raise AgentNotFoundError()
    payload.pop("bound_agent_id", None)
    payload["app_id"] = agent.app_id
    payload["backing_app_id"] = roster_service.runtime_backing_app_id(agent)
    payload["hidden_app_backed"] = bool(agent.backing_app_id and agent.backing_app_id != agent.app_id)
    payload["id"] = agent.id
    debug_conversation_id = roster_service.get_or_create_build_conversation(
        tenant_id=app_model.tenant_id,
        agent_id=agent.id,
        account_id=current_user.id,
        commit=False,
    )
    message_count = roster_service.count_agent_app_debug_conversation_messages(
        conversation_id=debug_conversation_id,
    )
    payload["debug_conversation_id"] = debug_conversation_id
    payload["debug_conversation_has_messages"] = message_count > 0
    payload["debug_conversation_message_count"] = message_count
    payload["role"] = agent.role or ""
    payload["access_ready"] = agent_has_workflow_callable_active_snapshot(session=session, agent=agent)
    permissions = application_services().rbac.members.permissions(
        app_model.tenant_id,
        current_user.id,
        agent_id=agent.id,
    )
    payload["permission_keys"] = permissions.agent.permission_keys_by_resource_ids([agent.id]).get(agent.id, [])
    return AgentAppDetailWithSite.model_validate(payload).model_dump(mode="json", exclude={"bound_agent_id"})


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


def _resolve_agent_app_model(session: Session, *, tenant_id: str, agent_id: UUID) -> App:
    return _agent_roster_service(session).get_agent_app_model(tenant_id=tenant_id, agent_id=str(agent_id))


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


@console_ns.route("/agent/<uuid:agent_id>/debug-conversation/refresh")
class AgentDebugConversationRefreshApi(Resource):
    @error_responses(AgentBuildSandboxNotFoundError, AgentNotFoundError)
    @console_ns.response(
        200,
        "Agent debug conversation refreshed",
        console_ns.models[AgentDebugConversationRefreshResponse.__name__],
    )
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session
    def post(self, session: Session, tenant_id: str, current_user: Account, agent_id: UUID):
        debug_conversation_id = _agent_roster_service(session).reset_build_conversation(
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account_id=current_user.id,
        )
        return AgentDebugConversationRefreshResponse(
            debug_conversation_id=debug_conversation_id,
            debug_conversation_has_messages=False,
            debug_conversation_message_count=0,
        ).model_dump(mode="json")


@console_ns.route("/agent/<uuid:agent_id>/publish")
class AgentPublishApi(Resource):
    @error_responses(
        AgentModelNotConfiguredError,
        AgentNotFoundError,
        AgentVersionNotFoundError,
        InvalidComposerConfigError,
        PlaintextSecretNotAllowedError,
    )
    @console_ns.expect(console_ns.models[AgentPublishPayload.__name__])
    @console_ns.response(200, "Agent draft published", console_ns.models[AgentPublishResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_RELEASE_AND_VERSION, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session
    @model_validate(AgentPublishPayload)
    def post(
        self,
        req_data: AgentPublishPayload,
        session: Session,
        tenant_id: str,
        current_user: Account,
        agent_id: UUID,
    ):
        return AgentComposerService.publish_agent_app_draft(
            session=session,
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account_id=current_user.id,
            version_note=req_data.version_note,
        )


@console_ns.route("/agent/<uuid:agent_id>/build-draft/checkout")
class AgentBuildDraftCheckoutApi(Resource):
    @error_responses(AgentBuildSandboxNotFoundError, AgentNotFoundError, AgentVersionNotFoundError)
    @console_ns.expect(console_ns.models[AgentBuildDraftCheckoutPayload.__name__])
    @console_ns.response(200, "Agent build draft checked out", console_ns.models[AgentBuildDraftResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_EDIT, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session(write=False)
    @model_validate(AgentBuildDraftCheckoutPayload)
    def post(
        self,
        req_data: AgentBuildDraftCheckoutPayload,
        session: Session,
        tenant_id: str,
        current_user: Account,
        agent_id: UUID,
    ):
        return AgentComposerService.checkout_agent_app_build_draft(
            session=session,
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account_id=current_user.id,
            force=req_data.force,
        )


@console_ns.route("/agent/<uuid:agent_id>/build-draft")
class AgentBuildDraftApi(Resource):
    @error_responses(AgentVersionNotFoundError)
    @console_ns.response(200, "Agent build draft", console_ns.models[AgentBuildDraftResponse.__name__])
    @console_ns.response(404, "Agent build draft not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session(write=False)
    def get(self, session: Session, tenant_id: str, current_user: Account, agent_id: UUID):
        return AgentComposerService.load_agent_app_build_draft(
            session=session,
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account_id=current_user.id,
        )

    @error_responses(AgentNotFoundError, AgentSoulLockedError, AgentVersionNotFoundError)
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(200, "Agent build draft saved", console_ns.models[AgentBuildDraftResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_EDIT, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session
    @model_validate(ComposerSavePayload)
    def put(
        self,
        req_data: ComposerSavePayload,
        session: Session,
        tenant_id: str,
        current_user: Account,
        agent_id: UUID,
    ):
        return AgentComposerService.save_agent_app_build_draft(
            session=session,
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account_id=current_user.id,
            payload=req_data,
        )

    @error_responses(AgentBuildSandboxNotFoundError, AgentNotFoundError)
    @console_ns.response(200, "Agent build draft discarded", console_ns.models[AgentSimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_EDIT, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session(write=False)
    def delete(self, session: Session, tenant_id: str, current_user: Account, agent_id: UUID):
        return AgentComposerService.discard_agent_app_build_draft(
            session=session,
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account_id=current_user.id,
        )


@console_ns.route("/agent/<uuid:agent_id>/build-draft/apply")
class AgentBuildDraftApplyApi(Resource):
    @error_responses(
        AgentBuildSandboxNotFoundError,
        AgentHomeSnapshotCreateFailedError,
        AgentHomeSnapshotTooLargeError,
        AgentNotFoundError,
        AgentVersionNotFoundError,
        InvalidComposerConfigError,
        PlaintextSecretNotAllowedError,
    )
    @console_ns.response(200, "Agent build draft applied", console_ns.models[AgentBuildDraftApplyResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_EDIT, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session(write=False)
    def post(self, session: Session, tenant_id: str, current_user: Account, agent_id: UUID):
        return AgentComposerService.apply_agent_app_build_draft(
            session=session,
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account_id=current_user.id,
        )


@console_ns.route("/agent/<uuid:agent_id>/copy")
class AgentAppCopyApi(Resource):
    @error_responses(AgentNameConflictError, AgentNotFoundError, AgentVersionNotFoundError)
    @console_ns.expect(console_ns.models[AgentAppCopyPayload.__name__])
    @console_ns.response(201, "Agent app copied successfully", console_ns.models[AgentAppDetailWithSite.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_CREATE, Workspace()))
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session
    @model_validate(AgentAppCopyPayload)
    def post(
        self,
        req_data: AgentAppCopyPayload,
        session: Session,
        tenant_id: str,
        current_user: Account,
        agent_id: UUID,
    ):
        copied_app = _agent_roster_service(session).duplicate_agent_app(
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account=current_user,
            name=req_data.name,
            description=req_data.description,
            role=req_data.role,
            icon_type=req_data.icon_type,
            icon=req_data.icon,
            icon_background=req_data.icon_background,
        )
        return _serialize_agent_app_detail(session, copied_app, current_user=current_user), 201


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
    @model_validate(AgentInviteOptionsQuery)
    def get(
        self,
        req_data: AgentInviteOptionsQuery,
        context: RequestContext,
    ) -> dict[str, object]:
        """Return visible Workflow-callable Agents and their current workflow usage."""
        return dump_response(
            AgentInviteOptionsResponse,
            application_services().agent_invite_options.list(
                context,
                page=req_data.page,
                limit=req_data.limit,
                keyword=req_data.keyword,
                app_id=req_data.app_id,
            ),
        )


def _agent_log_query() -> AgentLogQuery:
    """Parse repeated and indexed log query parameters, including singular aliases."""
    query_data: dict[str, object] = dict(request.args.to_dict(flat=True))
    query_data["sources"] = _query_values("sources", "source")
    query_data["statuses"] = _query_values("statuses", "status")
    query = AgentLogsQuery.model_validate(query_data)
    return AgentLogQuery(
        page=query.page,
        limit=query.limit,
        keyword=query.keyword,
        statuses=tuple(query.statuses),
        sources=tuple(query.sources),
        sort_by=query.sort_by,
        sort_order=query.sort_order,
        start=query.start,
        end=query.end,
    )


@console_ns.route("/agent/<uuid:agent_id>/logs")
class AgentLogsApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.doc(params=query_params_from_model(AgentLogsQuery))
    @console_ns.response(HTTPStatus.OK, "Agent logs", console_ns.models[AgentLogListResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID) -> dict[str, object]:
        """Return the admitted Agent's conversation logs."""
        query = _agent_log_query()
        try:
            payload = application_services().agent_observability.list_logs(context, str(agent_id), query)
        except AgentObservabilityNotFoundError as exc:
            raise AgentNotFoundError from exc
        except ValueError as exc:
            abort(HTTPStatus.BAD_REQUEST, description=str(exc))
        return dump_response(AgentLogListResponse, payload)


@console_ns.route("/agent/<uuid:agent_id>/logs/<uuid:conversation_id>/messages")
class AgentLogMessagesApi(Resource):
    @error_responses(AgentNotFoundError)
    @console_ns.doc(params=query_params_from_model(AgentLogsQuery))
    @console_ns.response(HTTPStatus.OK, "Agent log messages", console_ns.models[AgentLogMessageListResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, conversation_id: UUID) -> dict[str, object]:
        """Return the admitted Agent's messages for a conversation."""
        query = _agent_log_query()
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
