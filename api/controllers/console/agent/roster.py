from uuid import UUID

from flask import abort, request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, Field, field_validator
from sqlalchemy import func, select

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.agent.app_helpers import resolve_agent_app_model
from controllers.console.apikey import ApiKeyItem, ApiKeyList, BaseApiKeyListResource, BaseApiKeyResource
from controllers.console.app.app import (
    AppDetailWithSite as GenericAppDetailWithSite,
)
from controllers.console.app.app import (
    AppListQuery,
    _normalize_app_list_query_args,
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
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    enterprise_license_required,
    is_admin_or_owner_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.agent_fields import (
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
from libs.datetime_utils import parse_time_range
from libs.helper import dump_response
from libs.login import login_required
from models import Account
from models.enums import ApiTokenType
from models.model import ApiToken, App, IconType
from services.agent.errors import AgentNotFoundError
from services.agent.observability_service import (
    AgentLogQueryParams,
    AgentObservabilityService,
    AgentStatisticsQueryParams,
)
from services.agent.roster_service import AgentRosterService
from services.app_service import AppListParams, AppService, CreateAppParams
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.agent_entities import RosterListQuery
from services.feature_service import FeatureService


class AgentInviteOptionsQuery(RosterListQuery):
    app_id: str | None = Field(default=None, description="Workflow app id for in-current-workflow markers")


class AgentIdPath(BaseModel):
    agent_id: str


class AgentAppCreatePayload(BaseModel):
    name: str = Field(..., min_length=1, description="Agent name")
    description: str | None = Field(default=None, description="Agent description (max 400 chars)", max_length=400)
    role: str = Field(..., min_length=1, description="Agent role", max_length=255)
    icon_type: IconType | None = Field(default=None, description="Icon type")
    icon: str | None = Field(default=None, description="Icon")
    icon_background: str | None = Field(default=None, description="Icon background color")

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str) -> str:
        role = value.strip()
        if not role:
            raise ValueError("Agent role is required.")
        return role


# Keep agent-app roster DTOs agent-specific instead of reusing the shared
# /apps response/request models. The roster surface needs Agent-only fields such
# as `role`, while the generic console/apps contracts must stay unchanged.
class AgentAppUpdatePayload(GenericUpdateAppPayload):
    role: str = Field(..., min_length=1, description="Agent role", max_length=255)

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str) -> str:
        role = value.strip()
        if not role:
            raise ValueError("Agent role is required.")
        return role


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
        role = value.strip()
        if not role:
            raise ValueError("Agent role is required when provided.")
        return role


class AgentApiStatusPayload(BaseModel):
    enable_api: bool = Field(..., description="Enable or disable Agent service API")


class AgentApiAccessResponse(BaseModel):
    enabled: bool
    service_api_base_url: str
    streaming_only: bool = True
    chat_endpoint: str
    stop_endpoint: str
    conversations_endpoint: str
    messages_endpoint: str
    files_upload_endpoint: str
    parameters_endpoint: str
    info_endpoint: str
    meta_endpoint: str
    api_rpm: int
    api_rph: int
    api_key_count: int


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
            "or workflow:<app_id>:<workflow_id>:<version>:<node_id>"
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
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            return [item for item in value if item]
        return []

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
        description="Filter by all, console/explore, api/service-api, web-app, debugger, openapi, or trigger",
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
    app_id: str | None = None
    debug_conversation_id: str | None = None
    role: str | None = None
    active_config_is_published: bool = False
    published_reference_count: int = 0
    published_references: list[AgentAppPublishedReferenceResponse] = Field(default_factory=list)


class AgentAppDetailWithSite(GenericAppDetailWithSite):
    app_id: str | None = None
    debug_conversation_id: str | None = None
    role: str | None = None
    active_config_is_published: bool = False


class AgentDebugConversationRefreshResponse(BaseModel):
    debug_conversation_id: str


class AgentAppPagination(GenericAppPagination):
    data: list[AgentAppPartial] = Field(  # type: ignore[assignment]  # pyrefly: ignore[bad-override-mutable-attribute]
        validation_alias=AliasChoices("items", "data")
    )


register_schema_models(
    console_ns,
    AgentAppCreatePayload,
    AgentAppUpdatePayload,
    AgentAppCopyPayload,
    AgentApiStatusPayload,
    AgentInviteOptionsQuery,
    AgentLogsQuery,
    AgentStatisticsQuery,
    AgentIdPath,
    AppListQuery,
    RosterListQuery,
)
register_response_schema_models(
    console_ns,
    AgentAppPagination,
    AgentApiAccessResponse,
    AgentAppPublishedReferenceResponse,
    AgentAppDetailWithSite,
    AgentAppPartial,
    AgentDebugConversationRefreshResponse,
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


def _agent_roster_service() -> AgentRosterService:
    return AgentRosterService(db.session)


def _serialize_agent_app_detail(app_model, *, current_user: Account) -> dict:
    """Serialize an Agent App detail using roster-only DTOs.

    `/agent` responses are roster-shaped rather than raw app-shaped: `id`
    becomes the backing roster Agent id, `app_id` carries the underlying App
    id, and `role` is injected from the backing roster Agent. Keeping that
    remap in this serializer lets generated console/agent contracts expose the
    roster persona fields without widening the shared /apps detail schema.
    """

    app_model = AppService().get_app(app_model)
    if FeatureService.get_system_features().webapp_auth.enabled:
        app_setting = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=str(app_model.id))
        app_model.access_mode = app_setting.access_mode  # type: ignore[attr-defined]

    roster_service = _agent_roster_service()
    payload = AgentAppDetailWithSite.model_validate(app_model, from_attributes=True).model_dump(mode="json")
    agent = roster_service.get_app_backing_agent(tenant_id=app_model.tenant_id, app_id=str(app_model.id))
    if not agent:
        raise AgentNotFoundError()
    payload.pop("bound_agent_id", None)
    payload["app_id"] = str(app_model.id)
    payload["id"] = agent.id
    payload["debug_conversation_id"] = roster_service.get_or_create_agent_app_debug_conversation_id(
        tenant_id=app_model.tenant_id,
        agent_id=agent.id,
        account_id=current_user.id,
    )
    payload["role"] = agent.role or ""
    payload["active_config_is_published"] = roster_service.active_config_is_published(
        tenant_id=app_model.tenant_id,
        agent=agent,
    )
    return payload


def _serialize_agent_app_pagination(app_pagination, *, tenant_id: str, current_user: Account) -> dict:
    """Serialize Agent App lists with roster-shaped items.

    Each item starts from the shared App list shape, then drops
    `bound_agent_id`, rewrites `id` to the backing roster Agent id, stores the
    original App id in `app_id`, and injects roster-only `role` when a backing
    Agent is present.
    """

    app_ids = [str(app.id) for app in app_pagination.items]
    roster_service = _agent_roster_service()
    agents_by_app_id = roster_service.load_app_backing_agents_by_app_id(
        tenant_id=tenant_id,
        app_ids=app_ids,
    )
    active_config_is_published_by_agent_id = roster_service.load_active_config_is_published_by_agent_id(
        tenant_id=tenant_id,
        agents=list(agents_by_app_id.values()),
    )
    published_references_by_agent_id = roster_service.load_published_references_by_agent_id(
        tenant_id=tenant_id,
        agent_ids=[agent.id for agent in agents_by_app_id.values()],
    )
    debug_conversation_ids_by_agent_id = roster_service.load_or_create_agent_app_debug_conversation_ids_by_agent_id(
        tenant_id=tenant_id,
        agents=list(agents_by_app_id.values()),
        account_id=current_user.id,
    )
    payload = AgentAppPagination.model_validate(app_pagination, from_attributes=True).model_dump(mode="json")
    for item in payload["data"]:
        app_id = item["id"]
        item.pop("bound_agent_id", None)
        agent = agents_by_app_id.get(app_id)
        if agent:
            item["app_id"] = app_id
            item["id"] = agent.id
            item["debug_conversation_id"] = debug_conversation_ids_by_agent_id.get(agent.id)
            item["role"] = agent.role or ""
            item["active_config_is_published"] = active_config_is_published_by_agent_id.get(agent.id, False)
            published_references = published_references_by_agent_id.get(agent.id, [])
            item["published_reference_count"] = len(published_references)
            item["published_references"] = [
                {
                    "app_id": reference["app_id"],
                    "app_name": reference["app_name"],
                    "app_icon_type": reference["app_icon_type"],
                    "app_icon": reference["app_icon"],
                    "app_icon_background": reference["app_icon_background"],
                }
                for reference in published_references
            ]
    return AgentAppPagination.model_validate(payload).model_dump(
        mode="json",
        exclude={"data": {"__all__": {"bound_agent_id"}}},
    )


def _resolve_agent_app_model(*, tenant_id: str, agent_id: UUID):
    return resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)


def _agent_api_key_count(app_id: str) -> int:
    return (
        db.session.scalar(
            select(func.count(ApiToken.id)).where(
                ApiToken.type == ApiTokenType.APP,
                ApiToken.app_id == app_id,
            )
        )
        or 0
    )


def _serialize_agent_api_access(app_model: App) -> dict:
    base_url = app_model.api_base_url
    response = AgentApiAccessResponse(
        enabled=bool(app_model.enable_api),
        service_api_base_url=base_url,
        chat_endpoint=f"{base_url}/chat-messages",
        stop_endpoint=f"{base_url}/chat-messages/{{task_id}}/stop",
        conversations_endpoint=f"{base_url}/conversations",
        messages_endpoint=f"{base_url}/messages",
        files_upload_endpoint=f"{base_url}/files/upload",
        parameters_endpoint=f"{base_url}/parameters",
        info_endpoint=f"{base_url}/info",
        meta_endpoint=f"{base_url}/meta",
        api_rpm=app_model.api_rpm or 0,
        api_rph=app_model.api_rph or 0,
        api_key_count=_agent_api_key_count(str(app_model.id)),
    )
    return response.model_dump(mode="json")


def _agent_observability_service() -> AgentObservabilityService:
    return AgentObservabilityService(db.session)


def _parse_observability_time_range(start: str | None, end: str | None, account: Account):
    timezone = account.timezone or "UTC"
    try:
        return parse_time_range(start, end, timezone)
    except ValueError as exc:
        abort(400, description=str(exc))


def _multi_query_values(name: str, legacy_name: str | None = None) -> list[str]:
    values: list[str] = []
    for query_name in (name, f"{name}[]"):
        values.extend(request.args.getlist(query_name))
    if legacy_name:
        values.extend(request.args.getlist(legacy_name))
    parsed: list[str] = []
    for value in values:
        parsed.extend(item.strip() for item in value.split(",") if item.strip())
    return parsed


@console_ns.route("/agent")
class AgentAppListApi(Resource):
    @console_ns.doc(params=query_params_from_model(AppListQuery))
    @console_ns.response(200, "Agent app list", console_ns.models[AgentAppPagination.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        args = AppListQuery.model_validate(_normalize_app_list_query_args(request.args))
        params = AppListParams(
            page=args.page,
            limit=args.limit,
            mode="agent",
            name=args.name,
            tag_ids=args.tag_ids,
            creator_ids=args.creator_ids,
            is_created_by_me=args.is_created_by_me,
            status="normal",
        )

        app_pagination = AppService().get_paginate_apps(current_user.id, current_tenant_id, params, db.session)
        if app_pagination is None:
            empty = AgentAppPagination(page=args.page, limit=args.limit, total=0, has_more=False, data=[])
            return empty.model_dump(mode="json")

        return _serialize_agent_app_pagination(
            app_pagination,
            tenant_id=current_tenant_id,
            current_user=current_user,
        )

    @console_ns.expect(console_ns.models[AgentAppCreatePayload.__name__])
    @console_ns.response(201, "Agent app created successfully", console_ns.models[AgentAppDetailWithSite.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        args = AgentAppCreatePayload.model_validate(console_ns.payload)
        params = CreateAppParams(
            name=args.name,
            description=args.description,
            mode="agent",
            agent_role=args.role,
            icon_type=args.icon_type,
            icon=args.icon,
            icon_background=args.icon_background,
        )

        app = AppService().create_app(current_tenant_id, params, current_user)
        return _serialize_agent_app_detail(app, current_user=current_user), 201


@console_ns.route("/agent/<uuid:agent_id>")
class AgentAppApi(Resource):
    @console_ns.response(200, "Agent app detail", console_ns.models[AgentAppDetailWithSite.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        return _serialize_agent_app_detail(app_model, current_user=current_user)

    @console_ns.expect(console_ns.models[AgentAppUpdatePayload.__name__])
    @console_ns.response(200, "Agent app updated successfully", console_ns.models[AgentAppDetailWithSite.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def put(self, tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        args = AgentAppUpdatePayload.model_validate(console_ns.payload)
        args_dict: AppService.ArgsDict = {
            "name": args.name,
            "description": args.description or "",
            "icon_type": args.icon_type,
            "icon": args.icon or "",
            "icon_background": args.icon_background or "",
            "use_icon_as_answer_icon": args.use_icon_as_answer_icon or False,
            "max_active_requests": args.max_active_requests or 0,
            "role": args.role,
        }
        updated = AppService().update_app(app_model, args_dict)
        return _serialize_agent_app_detail(updated, current_user=current_user)

    @console_ns.response(204, "Agent app deleted successfully")
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_tenant_id
    def delete(self, tenant_id: str, agent_id: UUID):
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        AppService().delete_app(app_model)
        return "", 204


@console_ns.route("/agent/<uuid:agent_id>/debug-conversation/refresh")
class AgentDebugConversationRefreshApi(Resource):
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
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account, agent_id: UUID):
        debug_conversation_id = _agent_roster_service().refresh_agent_app_debug_conversation_id(
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account_id=current_user.id,
        )
        return AgentDebugConversationRefreshResponse(debug_conversation_id=debug_conversation_id).model_dump(
            mode="json"
        )


@console_ns.route("/agent/<uuid:agent_id>/copy")
class AgentAppCopyApi(Resource):
    @console_ns.expect(console_ns.models[AgentAppCopyPayload.__name__])
    @console_ns.response(201, "Agent app copied successfully", console_ns.models[AgentAppDetailWithSite.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account, agent_id: UUID):
        args = AgentAppCopyPayload.model_validate(console_ns.payload or {})
        copied_app = _agent_roster_service().duplicate_agent_app(
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account=current_user,
            name=args.name,
            description=args.description,
            role=args.role,
            icon_type=args.icon_type,
            icon=args.icon,
            icon_background=args.icon_background,
        )
        return _serialize_agent_app_detail(copied_app, current_user=current_user), 201


@console_ns.route("/agent/<uuid:agent_id>/api-access")
class AgentApiAccessApi(Resource):
    @console_ns.response(200, "Agent service API access", console_ns.models[AgentApiAccessResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID):
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        return _serialize_agent_api_access(app_model)


@console_ns.route("/agent/<uuid:agent_id>/api-enable")
class AgentApiStatusApi(Resource):
    @console_ns.expect(console_ns.models[AgentApiStatusPayload.__name__])
    @console_ns.response(200, "Agent service API status updated", console_ns.models[AgentApiAccessResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_RELEASE_AND_VERSION)
    @with_current_tenant_id
    def post(self, tenant_id: str, agent_id: UUID):
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        args = AgentApiStatusPayload.model_validate(console_ns.payload)
        app_model = AppService().update_app_api_status(app_model, args.enable_api)
        return _serialize_agent_api_access(app_model)


@console_ns.route("/agent/<uuid:agent_id>/api-keys")
class AgentApiKeyListApi(BaseApiKeyListResource):
    resource_type = ApiTokenType.APP
    resource_model = App
    resource_id_field = "app_id"
    token_prefix = "app-"

    @console_ns.response(200, "Agent service API keys", console_ns.models[ApiKeyList.__name__])
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID) -> dict[str, object]:
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        return dump_response(ApiKeyList, self._get_api_key_list(str(app_model.id), tenant_id))

    @console_ns.response(201, "Agent service API key created", console_ns.models[ApiKeyItem.__name__])
    @console_ns.response(400, "Maximum keys exceeded")
    @with_current_tenant_id
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_RELEASE_AND_VERSION)
    def post(self, tenant_id: str, agent_id: UUID) -> tuple[dict[str, object], int]:
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        return dump_response(ApiKeyItem, self._create_api_key(str(app_model.id), tenant_id)), 201


@console_ns.route("/agent/<uuid:agent_id>/api-keys/<uuid:api_key_id>")
class AgentApiKeyApi(BaseApiKeyResource):
    resource_type = ApiTokenType.APP
    resource_model = App
    resource_id_field = "app_id"

    @console_ns.response(204, "Agent service API key deleted")
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_RELEASE_AND_VERSION)
    def delete(self, tenant_id: str, current_user: Account, agent_id: UUID, api_key_id: UUID) -> tuple[str, int]:
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        self._delete_api_key(str(app_model.id), str(api_key_id), tenant_id, current_user)
        return "", 204


@console_ns.route("/agent/invite-options")
class AgentInviteOptionsApi(Resource):
    @console_ns.doc(params=query_params_from_model(AgentInviteOptionsQuery))
    @console_ns.response(200, "Agent invite options", console_ns.models[AgentInviteOptionsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        query = AgentInviteOptionsQuery.model_validate(request.args.to_dict(flat=True))
        return dump_response(
            AgentInviteOptionsResponse,
            _agent_roster_service().list_invite_options(
                tenant_id=tenant_id,
                page=query.page,
                limit=query.limit,
                keyword=query.keyword,
                app_id=query.app_id,
            ),
        )


@console_ns.route("/agent/<uuid:agent_id>/logs")
class AgentLogsApi(Resource):
    @console_ns.doc(params=query_params_from_model(AgentLogsQuery))
    @console_ns.response(200, "Agent logs", console_ns.models[AgentLogListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        query_data: dict[str, object] = dict(request.args.to_dict(flat=True))
        query_data["sources"] = _multi_query_values("sources", "source")
        query_data["statuses"] = _multi_query_values("statuses", "status")
        query = AgentLogsQuery.model_validate(query_data)
        start, end = _parse_observability_time_range(query.start, query.end, current_user)
        try:
            payload = _agent_observability_service().list_logs(
                app=app_model,
                agent_id=str(agent_id),
                params=AgentLogQueryParams(
                    page=query.page,
                    limit=query.limit,
                    keyword=query.keyword,
                    statuses=tuple(query.statuses),
                    sources=tuple(query.sources),
                    sort_by=query.sort_by,
                    sort_order=query.sort_order,
                    start=start,
                    end=end,
                ),
            )
        except ValueError as exc:
            abort(400, description=str(exc))
        return dump_response(AgentLogListResponse, payload)


@console_ns.route("/agent/<uuid:agent_id>/logs/<uuid:conversation_id>/messages")
class AgentLogMessagesApi(Resource):
    @console_ns.doc(params=query_params_from_model(AgentLogsQuery))
    @console_ns.response(200, "Agent log messages", console_ns.models[AgentLogMessageListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user: Account, agent_id: UUID, conversation_id: UUID):
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        query_data: dict[str, object] = dict(request.args.to_dict(flat=True))
        query_data["sources"] = _multi_query_values("sources", "source")
        query_data["statuses"] = _multi_query_values("statuses", "status")
        query = AgentLogsQuery.model_validate(query_data)
        start, end = _parse_observability_time_range(query.start, query.end, current_user)
        try:
            payload = _agent_observability_service().list_log_messages(
                app=app_model,
                agent_id=str(agent_id),
                conversation_id=str(conversation_id),
                params=AgentLogQueryParams(
                    page=query.page,
                    limit=query.limit,
                    keyword=query.keyword,
                    statuses=tuple(query.statuses),
                    sources=tuple(query.sources),
                    sort_by=query.sort_by,
                    sort_order=query.sort_order,
                    start=start,
                    end=end,
                ),
            )
        except ValueError as exc:
            abort(400, description=str(exc))
        return dump_response(AgentLogMessageListResponse, payload)


@console_ns.route("/agent/<uuid:agent_id>/log-sources")
class AgentLogSourcesApi(Resource):
    @console_ns.response(200, "Agent log sources", console_ns.models[AgentLogSourceListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        payload = _agent_observability_service().list_log_sources(app=app_model, agent_id=str(agent_id))
        return dump_response(AgentLogSourceListResponse, payload)


@console_ns.route("/agent/<uuid:agent_id>/statistics/summary")
class AgentStatisticsSummaryApi(Resource):
    @console_ns.doc(params=query_params_from_model(AgentStatisticsQuery))
    @console_ns.response(
        200,
        "Agent monitoring summary and chart data",
        console_ns.models[AgentStatisticSummaryEnvelopeResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user: Account, agent_id: UUID):
        app_model = _resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        query = AgentStatisticsQuery.model_validate(request.args.to_dict(flat=True))
        timezone = current_user.timezone or "UTC"
        start, end = _parse_observability_time_range(query.start, query.end, current_user)
        try:
            payload = _agent_observability_service().get_statistics_summary(
                app=app_model,
                agent_id=str(agent_id),
                params=AgentStatisticsQueryParams(source=query.source, start=start, end=end, timezone=timezone),
            )
        except ValueError as exc:
            abort(400, description=str(exc))
        return dump_response(AgentStatisticSummaryEnvelopeResponse, payload)


@console_ns.route("/agent/<uuid:agent_id>/versions")
class AgentRosterVersionsApi(Resource):
    @console_ns.response(200, "Agent versions", console_ns.models[AgentConfigSnapshotListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID):
        return dump_response(
            AgentConfigSnapshotListResponse,
            {"data": _agent_roster_service().list_agent_versions(tenant_id=tenant_id, agent_id=str(agent_id))},
        )


@console_ns.route("/agent/<uuid:agent_id>/versions/<uuid:version_id>")
class AgentRosterVersionDetailApi(Resource):
    @console_ns.response(200, "Agent version detail", console_ns.models[AgentConfigSnapshotDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID, version_id: UUID):
        return dump_response(
            AgentConfigSnapshotDetailResponse,
            _agent_roster_service().get_agent_version_detail(
                tenant_id=tenant_id,
                agent_id=str(agent_id),
                version_id=str(version_id),
            ),
        )


@console_ns.route("/agent/<uuid:agent_id>/versions/<uuid:version_id>/restore")
class AgentRosterVersionRestoreApi(Resource):
    @console_ns.response(200, "Agent version restored", console_ns.models[AgentConfigSnapshotRestoreResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, current_user: Account, agent_id: UUID, version_id: UUID):
        return dump_response(
            AgentConfigSnapshotRestoreResponse,
            _agent_roster_service().restore_agent_version(
                tenant_id=tenant_id,
                agent_id=str(agent_id),
                version_id=str(version_id),
                account_id=current_user.id,
            ),
        )
