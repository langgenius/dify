"""GET /openapi/v1/apps and per-app reads."""

from __future__ import annotations

import uuid as _uuid
from typing import Any, cast

from flask_restx import Resource
from sqlalchemy import select
from werkzeug.exceptions import Conflict, NotFound, UnprocessableEntity

from configs import dify_config
from controllers.common.app_access import AppAccessFilter, resolve_app_access_filter
from controllers.common.fields import Parameters
from controllers.common.wraps import RBACPermission, RBACResourceScope
from controllers.openapi import openapi_ns
from controllers.openapi._contract import accepts, returns
from controllers.openapi._input_schema import EMPTY_INPUT_SCHEMA, build_input_schema, resolve_app_config
from controllers.openapi._models import (
    SUPPORTED_APP_TYPES,
    AppDescribeInfo,
    AppDescribeQuery,
    AppDescribeResponse,
    AppDiscoveryItem,
    AppDiscoveryModel,
    AppDiscoveryQuery,
    AppDiscoveryResponse,
    AppDiscoveryTool,
    AppListQuery,
    AppListResponse,
    AppListRow,
)
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData, CallerKind, RBACRequirement
from controllers.service_api.app.error import AppUnavailableError
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from extensions.ext_database import db
from libs.oauth_bearer import Scope, TokenType
from models import App
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource, AgentStatus
from models.enums import AppStatus
from models.model import AppMode, AppModelConfig
from services.account_service import TenantService
from services.app_service import AppListParams, AppService

_ALLOWED_DESCRIBE_FIELDS: frozenset[str] = frozenset({"info", "parameters", "input_schema"})


def _is_listable(app: App) -> bool:
    """Whether the openapi app face exposes this app (curated, listable types only)."""
    return app.mode in SUPPORTED_APP_TYPES


_EMPTY_PARAMETERS: dict[str, Any] = {
    "opening_statement": None,
    "suggested_questions": [],
    "user_input_form": [],
    "file_upload": None,
    "system_parameters": {},
}


class AppReadResource(Resource):
    """Base for per-app read endpoints; subclasses call `_load()` for membership/exists checks."""

    def _load(self, app_id: str, workspace_id: str | None = None) -> App:
        try:
            parsed_uuid = _uuid.UUID(app_id)
            is_uuid = True
        except ValueError:
            parsed_uuid = None
            is_uuid = False

        if is_uuid:
            # ``str(parsed_uuid)`` normalises to the canonical dashed form.
            app = AppService.get_visible_app_by_id(str(parsed_uuid), session=db.session())
            if app is None:
                raise NotFound("app not found")
        else:
            if not workspace_id:
                raise UnprocessableEntity("workspace_id is required for name-based lookup")
            matches = AppService.find_visible_apps_by_name(name=app_id, tenant_id=workspace_id, session=db.session())
            if len(matches) == 0:
                raise NotFound("app not found")
            if len(matches) > 1:
                lines = [f"app name {app_id!r} is ambiguous — re-run with a UUID:\n\n"]
                lines.append(f"  {'ID':<36}  {'MODE':<12}  NAME\n")
                for m in matches:
                    lines.append(f"  {str(m.id):<36}  {str(m.mode.value):<12}  {m.name}\n")
                raise Conflict("".join(lines))
            app = matches[0]

        return app


def parameters_payload(app: App) -> dict:
    """Mirrors service_api/app/app.py::AppParameterApi response body."""
    features_dict, user_input_form = resolve_app_config(app)
    parameters = get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)
    return Parameters.model_validate(parameters).model_dump(mode="json")


def build_app_describe_response(app: App, fields: set[str] | None) -> AppDescribeResponse:
    """Public projection of an app (name / params / input schema) — never internal config."""
    want_info = fields is None or "info" in fields
    want_params = fields is None or "parameters" in fields
    want_schema = fields is None or "input_schema" in fields

    info = (
        AppDescribeInfo(
            id=str(app.id),
            name=app.name,
            mode=app.mode,
            description=app.description,
            updated_at=app.updated_at.isoformat() if app.updated_at else None,
            service_api_enabled=bool(app.enable_api),
            is_agent=app.mode in (AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT),
        )
        if want_info
        else None
    )

    parameters: dict[str, Any] | None = None
    input_schema: dict[str, Any] | None = None
    if want_params:
        try:
            parameters = parameters_payload(app)
        except AppUnavailableError:
            parameters = dict(_EMPTY_PARAMETERS)
    if want_schema:
        try:
            input_schema = build_input_schema(app)
        except AppUnavailableError:
            input_schema = dict(EMPTY_INPUT_SCHEMA)

    return AppDescribeResponse(info=info, parameters=parameters, input_schema=input_schema)


def _legacy_tool_projection(tool: object) -> AppDiscoveryTool | None:
    """Return the non-secret identity fields from a legacy Agent tool entry."""
    if not isinstance(tool, dict):
        return None

    return AppDiscoveryTool(
        provider_id=tool.get("provider_id") or tool.get("provider_name"),
        provider_type=tool.get("provider_type"),
        plugin_id=tool.get("plugin_unique_identifier"),
        tool_name=tool.get("tool_name"),
        enabled=bool(tool.get("enabled", True)),
    )


def _agent_soul_projection(
    snapshot: AgentConfigSnapshot | None,
) -> tuple[AppDiscoveryModel | None, list[AppDiscoveryTool]]:
    """Project a published Agent Soul without exposing credential references.

    Agent Soul snapshots are the source of truth for Agent V2. Their model and
    tool entries include credential references and runtime parameters, so this
    projection intentionally selects only stable identifiers needed by external
    observability systems.
    """
    if snapshot is None:
        return None, []

    soul = snapshot.config_snapshot_dict
    raw_model = soul.get("model")
    model = None
    if isinstance(raw_model, dict):
        model = AppDiscoveryModel(
            provider=raw_model.get("model_provider"),
            name=raw_model.get("model"),
            plugin_id=raw_model.get("plugin_id"),
        )

    raw_tools = soul.get("tools")
    raw_dify_tools = raw_tools.get("dify_tools") if isinstance(raw_tools, dict) else []
    tools: list[AppDiscoveryTool] = []
    if isinstance(raw_dify_tools, list):
        for tool in raw_dify_tools:
            if not isinstance(tool, dict):
                continue
            tools.append(
                AppDiscoveryTool(
                    provider_id=tool.get("provider_id"),
                    provider_type=tool.get("provider_type"),
                    plugin_id=tool.get("plugin_id"),
                    provider=tool.get("provider"),
                    tool_name=tool.get("tool_name"),
                    enabled=bool(tool.get("enabled", True)),
                )
            )
    return model, tools


def _load_discovery_configuration(
    apps: list[App], *, tenant_id: str
) -> tuple[dict[str, AppModelConfig], dict[str, AgentConfigSnapshot]]:
    """Batch-load legacy configs and published Agent Soul snapshots for one page.

    Discovery is read-only and paginated. Loading both configuration stores in
    batches keeps a page of Agent Apps from triggering a per-app query pattern.
    """
    app_model_config_ids = [str(app.app_model_config_id) for app in apps if app.app_model_config_id]
    legacy_configs = db.session.scalars(
        select(AppModelConfig).where(AppModelConfig.id.in_(app_model_config_ids))
    ).all() if app_model_config_ids else []
    configs_by_id = {str(config.id): config for config in legacy_configs}

    app_ids = [app.id for app in apps]
    agents = db.session.scalars(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.app_id.in_(app_ids),
            Agent.scope == AgentScope.ROSTER,
            Agent.source == AgentSource.AGENT_APP,
            Agent.status == AgentStatus.ACTIVE,
            Agent.active_config_snapshot_id.is_not(None),
        )
    ).all() if app_ids else []
    snapshot_ids = [str(agent.active_config_snapshot_id) for agent in agents if agent.active_config_snapshot_id]
    snapshots = db.session.scalars(
        select(AgentConfigSnapshot).where(
            AgentConfigSnapshot.tenant_id == tenant_id,
            AgentConfigSnapshot.id.in_(snapshot_ids),
        )
    ).all() if snapshot_ids else []
    snapshots_by_id = {str(snapshot.id): snapshot for snapshot in snapshots}
    snapshots_by_app_id = {
        str(agent.app_id): snapshots_by_id[str(agent.active_config_snapshot_id)]
        for agent in agents
        if agent.app_id and agent.active_config_snapshot_id and str(agent.active_config_snapshot_id) in snapshots_by_id
    }
    return configs_by_id, snapshots_by_app_id


def build_app_discovery_item(
    app: App,
    *,
    legacy_config: AppModelConfig | None,
    agent_snapshot: AgentConfigSnapshot | None,
) -> AppDiscoveryItem:
    """Build the safe configuration projection for a legacy app or Agent V2 app."""
    model: AppDiscoveryModel | None = None
    tools: list[AppDiscoveryTool] = []
    agent_strategy: str | None = None

    if app.mode == AppMode.AGENT:
        model, tools = _agent_soul_projection(agent_snapshot)
    elif legacy_config is not None:
        raw_model = legacy_config.model_dict
        model = AppDiscoveryModel(provider=raw_model.get("provider"), name=raw_model.get("name"))
        agent_mode = legacy_config.agent_mode_dict
        agent_strategy = agent_mode.get("strategy")
        for tool in agent_mode.get("tools") or []:
            projection = _legacy_tool_projection(tool)
            if projection is not None:
                tools.append(projection)

    return AppDiscoveryItem(
        id=app.id,
        name=app.name,
        description=app.description,
        mode=app.mode,
        icon=app.icon,
        icon_background=app.icon_background,
        updated_at=app.updated_at.isoformat() if app.updated_at else None,
        model=model,
        agent_strategy=agent_strategy,
        tools=tools,
    )


@openapi_ns.route("/apps/discovery")
class AppDiscoveryApi(Resource):
    """List workspace apps with their safe runtime identities.

    Unlike ``GET /apps``, discovery is an account-authenticated management
    surface. It includes API-disabled apps because observability integrations
    must be able to correlate every workspace app, not only apps that expose a
    Service API key. RBAC is applied before pagination just like the ordinary
    app list.
    """

    @auth_router.guard_workspace(scope=Scope.APPS_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, AppDiscoveryResponse, description="App runtime discovery")
    @accepts(query=AppDiscoveryQuery)
    def get(self, *, auth_data: AuthData, query: AppDiscoveryQuery):
        workspace_id = query.workspace_id
        if auth_data.account_id is None:
            raise NotFound("account not found")

        apply_rbac_filter = dify_config.RBAC_ENABLED and auth_data.caller_kind != CallerKind.END_USER
        access_filter = AppAccessFilter.unrestricted()
        if apply_rbac_filter:
            access_filter = resolve_app_access_filter(workspace_id, str(auth_data.account_id))

        params = AppListParams(
            page=query.page,
            limit=query.limit,
            mode="discovery",
            status=AppStatus.NORMAL,
        )
        if apply_rbac_filter:
            access_filter.apply_to_params(params)

        pagination = AppService().get_paginate_apps(str(auth_data.account_id), workspace_id, params, db.session())
        if pagination is None:
            return AppDiscoveryResponse(page=query.page, limit=query.limit, total=0, has_more=False, data=[])

        apps = list(pagination.items)
        configs_by_id, snapshots_by_app_id = _load_discovery_configuration(apps, tenant_id=workspace_id)
        items = [
            build_app_discovery_item(
                app,
                legacy_config=configs_by_id.get(str(app.app_model_config_id)),
                agent_snapshot=snapshots_by_app_id.get(str(app.id)),
            )
            for app in apps
        ]
        total = pagination.total
        return AppDiscoveryResponse(
            page=query.page,
            limit=query.limit,
            total=total,
            has_more=query.page * query.limit < total,
            data=items,
        )


@openapi_ns.route("/apps/<string:app_id>")
class AppDescribeApi(AppReadResource):
    @auth_router.guard(
        scope=Scope.APPS_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
        rbac=RBACRequirement(resource_type=RBACResourceScope.APP, scene=RBACPermission.APP_VIEW_LAYOUT),
    )
    @returns(200, AppDescribeResponse, description="App description")
    @accepts(query=AppDescribeQuery)
    def get(self, app_id: str, *, auth_data: AuthData, query: AppDescribeQuery):
        # describe is UUID-only (workspace_id query param dropped in #37212).
        app = self._load(app_id)
        return build_app_describe_response(app, query.fields)


@openapi_ns.route("/apps")
class AppListApi(Resource):
    @auth_router.guard_workspace(scope=Scope.APPS_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, AppListResponse, description="App list")
    @accepts(query=AppListQuery)
    def get(self, *, auth_data: AuthData, query: AppListQuery):
        workspace_id = query.workspace_id

        empty = AppListResponse(page=query.page, limit=query.limit, total=0, has_more=False, data=[])

        if query.name:
            try:
                parsed_uuid = _uuid.UUID(query.name)
            except ValueError:
                parsed_uuid = None
        else:
            parsed_uuid = None

        # Compute RBAC-accessible app IDs when RBAC is enabled and the caller is an account.
        # ``None`` means unrestricted (caller can see all apps in the workspace);
        # an empty set or list means the caller has no accessible apps.
        # End-users bypass RBAC here — their access is controlled by scope upstream.
        apply_rbac_filter = (
            dify_config.RBAC_ENABLED
            and auth_data.caller_kind != CallerKind.END_USER
            and auth_data.account_id is not None
        )
        access_filter = AppAccessFilter.unrestricted()
        if apply_rbac_filter:
            access_filter = resolve_app_access_filter(workspace_id, str(auth_data.account_id))

        tenant_name: str | None = None
        if parsed_uuid is not None:
            app: App | None = AppService.get_visible_app_by_id(str(parsed_uuid), session=db.session())
            if app is None or str(app.tenant_id) != workspace_id:
                return empty
            if not _is_listable(app):
                return empty
            # Apply RBAC visibility to the UUID fast-path the same way the service
            # layer does for paginated queries (id in accessible set OR own app).
            if apply_rbac_filter and not access_filter.is_app_accessible(
                str(app.id), str(app.maintainer) if app.maintainer else None, str(auth_data.account_id)
            ):
                return empty
            tenant_name = TenantService.get_tenant_name(workspace_id, session=db.session())
            item = AppListRow(
                id=str(app.id),
                name=app.name,
                description=app.description,
                mode=app.mode,
                updated_at=app.updated_at.isoformat() if app.updated_at else None,
                workspace_id=str(workspace_id),
                workspace_name=tenant_name,
            )
            env = AppListResponse(page=1, limit=1, total=1, has_more=False, data=[item])
            return env

        params = AppListParams(
            page=query.page,
            limit=query.limit,
            mode=query.mode.value if query.mode else "all",  # type:ignore
            name=query.name,
            status=AppStatus.NORMAL,
            # Visibility gate pushed into the query — pagination.total stays
            # consistent across pages because invisible rows never count.
            openapi_visible=True,
        )

        if apply_rbac_filter:
            access_filter.apply_to_params(params)

        pagination = AppService().get_paginate_apps(str(auth_data.account_id), workspace_id, params, db.session())
        if pagination is None:
            return empty

        tenant_name = None
        if pagination.items:
            tenant_name = TenantService.get_tenant_name(workspace_id, session=db.session())

        items = [
            AppListRow(
                id=str(r.id),
                name=r.name,
                description=r.description,
                mode=r.mode,
                updated_at=r.updated_at.isoformat() if r.updated_at else None,
                workspace_id=str(workspace_id),
                workspace_name=tenant_name,
            )
            for r in pagination.items
            if _is_listable(r)
        ]

        env = AppListResponse(
            page=query.page,
            limit=query.limit,
            total=cast(int, pagination.total),
            has_more=query.page * query.limit < cast(int, pagination.total),
            data=items,
        )
        return env
