"""App-info and Service API cards, one route per app mode."""

from __future__ import annotations

from http import HTTPStatus
from typing import Final

from flask_restx import Resource

from constants.oauth_bearer import Scope
from controllers.common.rbac import AgentBehindApp, PlainApp, RBACCheck, RBACPermission
from controllers.openapi import _app_settings as settings
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._models import (
    AgentAppInfo,
    AgentAppInfoPatch,
    AgentServiceApi,
    AppInfoPatch,
    AppSettingsInfo,
    ChatAppInfo,
    ChatAppInfoPatch,
    ServiceApi,
    ServiceApiPatch,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import ADMIN_ROLES, EDITOR_ROLES, account_settings_guards
from models import AppMode

_INFO_READ: Final = RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())
_INFO_WRITE: Final = RBACCheck(RBACPermission.APP_EDIT, PlainApp())
_AGENT_INFO_READ: Final = RBACCheck(RBACPermission.AGENT_PREVIEW, AgentBehindApp())
_AGENT_INFO_WRITE: Final = RBACCheck(RBACPermission.AGENT_EDIT, AgentBehindApp())
_API: Final = RBACCheck(RBACPermission.APP_RELEASE_AND_VERSION, PlainApp())
_AGENT_API_READ: Final = RBACCheck(RBACPermission.AGENT_ACCESS_POINT_VIEW, AgentBehindApp())
_AGENT_API_WRITE: Final = RBACCheck(RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentBehindApp())

_INFO_EXAMPLE: Final = Example(title="Read the app info", input={"app_id": "<app_id>"})
_RENAME_EXAMPLE: Final = Example(title="Rename the app", input={"app_id": "<app_id>", "name": "Release notes"})
_API_EXAMPLE: Final = Example(title="Read the Service API state", input={"app_id": "<app_id>"})
_API_ON_EXAMPLE: Final = Example(title="Turn the Service API on", input={"app_id": "<app_id>", "enabled": True})


@openapi_ns.route("/apps/<string:app_id>/app-info/workflow")
class WorkflowAppInfoApi(Resource):
    @endpoint(
        op="describe.app_info.workflow",
        kind=Kind.OBJECT,
        summary="Name, description, icon and run cap of a workflow app",
        examples=(_INFO_EXAMPLE,),
        requirements=account_settings_guards(_INFO_READ, scope=Scope.APPS_READ, modes=(AppMode.WORKFLOW,), roles=None),
        returns=(HTTPStatus.OK, AppSettingsInfo, "App info"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.app_info(ctx, AppSettingsInfo)

    @endpoint(
        op="set.app_info.workflow",
        kind=Kind.OBJECT,
        summary="Change a workflow app's info; only the fields passed change",
        examples=(_RENAME_EXAMPLE,),
        requirements=account_settings_guards(
            _INFO_WRITE, scope=Scope.WORKSPACE_WRITE, modes=(AppMode.WORKFLOW,), roles=EDITOR_ROLES
        ),
        body=AppInfoPatch,
        returns=(HTTPStatus.OK, AppSettingsInfo, "App info"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: AppInfoPatch):
        return settings.update_app_info(ctx, body, AppSettingsInfo)


@openapi_ns.route("/apps/<string:app_id>/app-info/advanced-chat")
class AdvancedChatAppInfoApi(Resource):
    @endpoint(
        op="describe.app_info.advanced_chat",
        kind=Kind.OBJECT,
        summary="Name, description, icon and run cap of an advanced-chat app",
        examples=(_INFO_EXAMPLE,),
        requirements=account_settings_guards(
            _INFO_READ, scope=Scope.APPS_READ, modes=(AppMode.ADVANCED_CHAT,), roles=None
        ),
        returns=(HTTPStatus.OK, ChatAppInfo, "App info"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.app_info(ctx, ChatAppInfo)

    @endpoint(
        op="set.app_info.advanced_chat",
        kind=Kind.OBJECT,
        summary="Change an advanced-chat app's info; only the fields passed change",
        examples=(_RENAME_EXAMPLE,),
        requirements=account_settings_guards(
            _INFO_WRITE, scope=Scope.WORKSPACE_WRITE, modes=(AppMode.ADVANCED_CHAT,), roles=EDITOR_ROLES
        ),
        body=ChatAppInfoPatch,
        returns=(HTTPStatus.OK, ChatAppInfo, "App info"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: ChatAppInfoPatch):
        return settings.update_app_info(ctx, body, ChatAppInfo)


@openapi_ns.route("/apps/<string:app_id>/app-info/chat")
class ChatAppInfoApi(Resource):
    @endpoint(
        op="describe.app_info.chat",
        kind=Kind.OBJECT,
        summary="Name, description, icon and run cap of a chat app",
        examples=(_INFO_EXAMPLE,),
        requirements=account_settings_guards(_INFO_READ, scope=Scope.APPS_READ, modes=(AppMode.CHAT,), roles=None),
        returns=(HTTPStatus.OK, ChatAppInfo, "App info"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.app_info(ctx, ChatAppInfo)

    @endpoint(
        op="set.app_info.chat",
        kind=Kind.OBJECT,
        summary="Change a chat app's info; only the fields passed change",
        examples=(_RENAME_EXAMPLE,),
        requirements=account_settings_guards(
            _INFO_WRITE, scope=Scope.WORKSPACE_WRITE, modes=(AppMode.CHAT,), roles=EDITOR_ROLES
        ),
        body=ChatAppInfoPatch,
        returns=(HTTPStatus.OK, ChatAppInfo, "App info"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: ChatAppInfoPatch):
        return settings.update_app_info(ctx, body, ChatAppInfo)


@openapi_ns.route("/apps/<string:app_id>/app-info/agent-chat")
class AgentChatAppInfoApi(Resource):
    @endpoint(
        op="describe.app_info.agent_chat",
        kind=Kind.OBJECT,
        summary="Name, description, icon and run cap of an agent-chat app",
        examples=(_INFO_EXAMPLE,),
        requirements=account_settings_guards(
            _INFO_READ, scope=Scope.APPS_READ, modes=(AppMode.AGENT_CHAT,), roles=None
        ),
        returns=(HTTPStatus.OK, ChatAppInfo, "App info"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.app_info(ctx, ChatAppInfo)

    @endpoint(
        op="set.app_info.agent_chat",
        kind=Kind.OBJECT,
        summary="Change an agent-chat app's info; only the fields passed change",
        examples=(_RENAME_EXAMPLE,),
        requirements=account_settings_guards(
            _INFO_WRITE, scope=Scope.WORKSPACE_WRITE, modes=(AppMode.AGENT_CHAT,), roles=EDITOR_ROLES
        ),
        body=ChatAppInfoPatch,
        returns=(HTTPStatus.OK, ChatAppInfo, "App info"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: ChatAppInfoPatch):
        return settings.update_app_info(ctx, body, ChatAppInfo)


@openapi_ns.route("/apps/<string:app_id>/app-info/completion")
class CompletionAppInfoApi(Resource):
    @endpoint(
        op="describe.app_info.completion",
        kind=Kind.OBJECT,
        summary="Name, description, icon and run cap of a completion app",
        examples=(_INFO_EXAMPLE,),
        requirements=account_settings_guards(
            _INFO_READ, scope=Scope.APPS_READ, modes=(AppMode.COMPLETION,), roles=None
        ),
        returns=(HTTPStatus.OK, AppSettingsInfo, "App info"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.app_info(ctx, AppSettingsInfo)

    @endpoint(
        op="set.app_info.completion",
        kind=Kind.OBJECT,
        summary="Change a completion app's info; only the fields passed change",
        examples=(_RENAME_EXAMPLE,),
        requirements=account_settings_guards(
            _INFO_WRITE, scope=Scope.WORKSPACE_WRITE, modes=(AppMode.COMPLETION,), roles=EDITOR_ROLES
        ),
        body=AppInfoPatch,
        returns=(HTTPStatus.OK, AppSettingsInfo, "App info"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: AppInfoPatch):
        return settings.update_app_info(ctx, body, AppSettingsInfo)


@openapi_ns.route("/apps/<string:app_id>/app-info/agent")
class AgentAppInfoApi(Resource):
    @endpoint(
        op="describe.app_info.agent",
        kind=Kind.OBJECT,
        summary="Name, description, icon, role and run cap of an agent app",
        examples=(_INFO_EXAMPLE,),
        requirements=account_settings_guards(
            _AGENT_INFO_READ, scope=Scope.APPS_READ, modes=(AppMode.AGENT,), roles=None
        ),
        returns=(HTTPStatus.OK, AgentAppInfo, "App info"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.app_info(ctx, AgentAppInfo)

    @endpoint(
        op="set.app_info.agent",
        kind=Kind.OBJECT,
        summary="Change an agent app's info; only the fields passed change",
        examples=(_RENAME_EXAMPLE,),
        requirements=account_settings_guards(
            _AGENT_INFO_WRITE, scope=Scope.WORKSPACE_WRITE, modes=(AppMode.AGENT,), roles=EDITOR_ROLES
        ),
        body=AgentAppInfoPatch,
        returns=(HTTPStatus.OK, AgentAppInfo, "App info"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: AgentAppInfoPatch):
        return settings.update_app_info(ctx, body, AgentAppInfo)


@openapi_ns.route("/apps/<string:app_id>/service-api")
class ServiceApiApi(Resource):
    @endpoint(
        op="describe.service_api",
        kind=Kind.OBJECT,
        summary="Whether an app's Service API is on, and its base URL (agent apps: describe.service_api.agent)",
        examples=(_API_EXAMPLE,),
        requirements=account_settings_guards(
            _API, scope=Scope.APPS_READ, modes=settings.REGULAR_MODES, roles=EDITOR_ROLES
        ),
        returns=(HTTPStatus.OK, ServiceApi, "Service API"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.service_api(ctx, ServiceApi)

    @endpoint(
        op="set.service_api",
        kind=Kind.OBJECT,
        summary="Turn an app's Service API on or off (agent apps: set.service_api.agent)",
        examples=(_API_ON_EXAMPLE,),
        requirements=account_settings_guards(
            _API, scope=Scope.WORKSPACE_WRITE, modes=settings.REGULAR_MODES, roles=ADMIN_ROLES
        ),
        body=ServiceApiPatch,
        returns=(HTTPStatus.OK, ServiceApi, "Service API"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: ServiceApiPatch):
        return settings.update_service_api(ctx, body.enabled, ServiceApi)


@openapi_ns.route("/apps/<string:app_id>/service-api/agent")
class AgentServiceApiApi(Resource):
    @endpoint(
        op="describe.service_api.agent",
        kind=Kind.OBJECT,
        summary="Whether an agent app's Service API is on, and its base URL",
        examples=(_API_EXAMPLE,),
        requirements=account_settings_guards(
            _AGENT_API_READ, scope=Scope.APPS_READ, modes=(AppMode.AGENT,), roles=EDITOR_ROLES
        ),
        returns=(HTTPStatus.OK, AgentServiceApi, "Service API"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.service_api(ctx, AgentServiceApi)

    @endpoint(
        op="set.service_api.agent",
        kind=Kind.OBJECT,
        summary="Turn an agent app's Service API on or off",
        examples=(_API_ON_EXAMPLE,),
        requirements=account_settings_guards(
            _AGENT_API_WRITE, scope=Scope.WORKSPACE_WRITE, modes=(AppMode.AGENT,), roles=ADMIN_ROLES
        ),
        body=ServiceApiPatch,
        returns=(HTTPStatus.OK, AgentServiceApi, "Service API"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: ServiceApiPatch):
        return settings.update_service_api(ctx, body.enabled, AgentServiceApi)
