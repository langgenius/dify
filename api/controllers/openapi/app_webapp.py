"""Web-app and web-app access cards, one route per app mode."""

from __future__ import annotations

from http import HTTPStatus
from typing import Final

from flask_restx import Resource

from constants.oauth_bearer import Scope
from controllers.common.rbac import AgentBehindApp, PlainApp, RBACCheck, RBACPermission
from controllers.openapi import _app_settings as settings
from controllers.openapi import openapi_ns
from controllers.openapi._app_settings import WebAppPath
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._models import (
    AdvancedChatWebApp,
    AdvancedChatWebAppPatch,
    AgentWebApp,
    ChatWebApp,
    ChatWebAppPatch,
    WebApp,
    WebAppAccess,
    WebAppAccessPayload,
    WebAppPatch,
    WebAppToken,
    WorkflowWebApp,
    WorkflowWebAppPatch,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    ADMIN_ROLES,
    EDITOR_ROLES,
    CheckWebAppAuthEnterprise,
    account_settings_guards,
)
from models import AppMode

_SITE_READ: Final = RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())
_SITE_WRITE: Final = RBACCheck(RBACPermission.APP_RELEASE_AND_VERSION, PlainApp())
_AGENT_SITE_READ: Final = RBACCheck(RBACPermission.AGENT_ACCESS_POINT_VIEW, AgentBehindApp())
_AGENT_SITE_WRITE: Final = RBACCheck(RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentBehindApp())
_ACCESS: Final = RBACCheck(RBACPermission.APP_ACCESS_CONFIG, PlainApp())
_AGENT_ACCESS: Final = RBACCheck(RBACPermission.AGENT_ACCESS_CONFIG, AgentBehindApp())

_WEBAPP_EXAMPLE: Final = Example(title="Read the web app settings", input={"app_id": "<app_id>"})
_WEBAPP_ON_EXAMPLE: Final = Example(
    title="Turn the web app on and set its title", input={"app_id": "<app_id>", "enabled": True, "title": "Support"}
)
_RESET_EXAMPLE: Final = Example(title="Rotate the web app URL", input={"app_id": "<app_id>"})
_ACCESS_EXAMPLE: Final = Example(title="Read who may open the web app", input={"app_id": "<app_id>"})
_ACCESS_SET_EXAMPLE: Final = Example(
    title="Let every member open the web app", input={"app_id": "<app_id>", "access_mode": "private_all"}
)


@openapi_ns.route("/apps/<string:app_id>/webapp/workflow")
class WorkflowWebAppApi(Resource):
    @endpoint(
        op="describe.webapp.workflow",
        kind=Kind.OBJECT,
        summary="A workflow app's web app: on or off, its URL token and page settings",
        examples=(_WEBAPP_EXAMPLE,),
        requirements=account_settings_guards(_SITE_READ, scope=Scope.APPS_READ, mode=AppMode.WORKFLOW, roles=None),
        returns=(HTTPStatus.OK, WorkflowWebApp, "Web app"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp(ctx, WorkflowWebApp, WebAppPath.WORKFLOW)

    @endpoint(
        op="set.webapp.workflow",
        kind=Kind.OBJECT,
        summary="Change a workflow app's web app; only the fields passed change",
        examples=(_WEBAPP_ON_EXAMPLE,),
        requirements=account_settings_guards(
            _SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.WORKFLOW, roles=EDITOR_ROLES
        ),
        body=WorkflowWebAppPatch,
        returns=(HTTPStatus.OK, WorkflowWebApp, "Web app"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: WorkflowWebAppPatch):
        return settings.update_webapp(ctx, body, WorkflowWebApp, WebAppPath.WORKFLOW)


@openapi_ns.route("/apps/<string:app_id>/webapp/workflow:reset")
class WorkflowWebAppResetApi(Resource):
    @endpoint(
        op="reset.webapp.workflow",
        kind=Kind.OBJECT,
        summary="Rotate a workflow app's web app URL; the old URL stops working",
        examples=(_RESET_EXAMPLE,),
        requirements=account_settings_guards(
            _SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.WORKFLOW, roles=ADMIN_ROLES
        ),
        returns=(HTTPStatus.OK, WebAppToken, "New URL token"),
    )
    def post(self, ctx: Context, app_id: str):
        return settings.reset_webapp(ctx, WebAppPath.WORKFLOW)


@openapi_ns.route("/apps/<string:app_id>/webapp-access/workflow")
class WorkflowWebAppAccessApi(Resource):
    @endpoint(
        op="describe.webapp_access.workflow",
        kind=Kind.OBJECT,
        summary="Who may open a workflow app's web app (Enterprise)",
        examples=(_ACCESS_EXAMPLE,),
        requirements=(
            *account_settings_guards(_ACCESS, scope=Scope.APPS_READ, mode=AppMode.WORKFLOW, roles=EDITOR_ROLES),
            CheckWebAppAuthEnterprise(),
        ),
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp_access(ctx)

    @endpoint(
        op="set.webapp_access.workflow",
        kind=Kind.OBJECT,
        summary="Set who may open a workflow app's web app (Enterprise)",
        examples=(_ACCESS_SET_EXAMPLE,),
        requirements=(
            *account_settings_guards(_ACCESS, scope=Scope.WORKSPACE_WRITE, mode=AppMode.WORKFLOW, roles=EDITOR_ROLES),
            CheckWebAppAuthEnterprise(),
        ),
        body=WebAppAccessPayload,
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def put(self, ctx: Context, app_id: str, *, body: WebAppAccessPayload):
        return settings.update_webapp_access(ctx, body)


@openapi_ns.route("/apps/<string:app_id>/webapp/advanced-chat")
class AdvancedChatWebAppApi(Resource):
    @endpoint(
        op="describe.webapp.advanced_chat",
        kind=Kind.OBJECT,
        summary="An advanced-chat app's web app: on or off, its URL token and page settings",
        examples=(_WEBAPP_EXAMPLE,),
        requirements=account_settings_guards(_SITE_READ, scope=Scope.APPS_READ, mode=AppMode.ADVANCED_CHAT, roles=None),
        returns=(HTTPStatus.OK, AdvancedChatWebApp, "Web app"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp(ctx, AdvancedChatWebApp, WebAppPath.CHAT)

    @endpoint(
        op="set.webapp.advanced_chat",
        kind=Kind.OBJECT,
        summary="Change an advanced-chat app's web app; only the fields passed change",
        examples=(_WEBAPP_ON_EXAMPLE,),
        requirements=account_settings_guards(
            _SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.ADVANCED_CHAT, roles=EDITOR_ROLES
        ),
        body=AdvancedChatWebAppPatch,
        returns=(HTTPStatus.OK, AdvancedChatWebApp, "Web app"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: AdvancedChatWebAppPatch):
        return settings.update_webapp(ctx, body, AdvancedChatWebApp, WebAppPath.CHAT)


@openapi_ns.route("/apps/<string:app_id>/webapp/advanced-chat:reset")
class AdvancedChatWebAppResetApi(Resource):
    @endpoint(
        op="reset.webapp.advanced_chat",
        kind=Kind.OBJECT,
        summary="Rotate an advanced-chat app's web app URL; the old URL stops working",
        examples=(_RESET_EXAMPLE,),
        requirements=account_settings_guards(
            _SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.ADVANCED_CHAT, roles=ADMIN_ROLES
        ),
        returns=(HTTPStatus.OK, WebAppToken, "New URL token"),
    )
    def post(self, ctx: Context, app_id: str):
        return settings.reset_webapp(ctx, WebAppPath.CHAT)


@openapi_ns.route("/apps/<string:app_id>/webapp-access/advanced-chat")
class AdvancedChatWebAppAccessApi(Resource):
    @endpoint(
        op="describe.webapp_access.advanced_chat",
        kind=Kind.OBJECT,
        summary="Who may open an advanced-chat app's web app (Enterprise)",
        examples=(_ACCESS_EXAMPLE,),
        requirements=(
            *account_settings_guards(_ACCESS, scope=Scope.APPS_READ, mode=AppMode.ADVANCED_CHAT, roles=EDITOR_ROLES),
            CheckWebAppAuthEnterprise(),
        ),
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp_access(ctx)

    @endpoint(
        op="set.webapp_access.advanced_chat",
        kind=Kind.OBJECT,
        summary="Set who may open an advanced-chat app's web app (Enterprise)",
        examples=(_ACCESS_SET_EXAMPLE,),
        requirements=(
            *account_settings_guards(
                _ACCESS, scope=Scope.WORKSPACE_WRITE, mode=AppMode.ADVANCED_CHAT, roles=EDITOR_ROLES
            ),
            CheckWebAppAuthEnterprise(),
        ),
        body=WebAppAccessPayload,
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def put(self, ctx: Context, app_id: str, *, body: WebAppAccessPayload):
        return settings.update_webapp_access(ctx, body)


@openapi_ns.route("/apps/<string:app_id>/webapp/chat")
class ChatWebAppApi(Resource):
    @endpoint(
        op="describe.webapp.chat",
        kind=Kind.OBJECT,
        summary="A chat app's web app: on or off, its URL token and page settings",
        examples=(_WEBAPP_EXAMPLE,),
        requirements=account_settings_guards(_SITE_READ, scope=Scope.APPS_READ, mode=AppMode.CHAT, roles=None),
        returns=(HTTPStatus.OK, ChatWebApp, "Web app"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp(ctx, ChatWebApp, WebAppPath.CHAT)

    @endpoint(
        op="set.webapp.chat",
        kind=Kind.OBJECT,
        summary="Change a chat app's web app; only the fields passed change",
        examples=(_WEBAPP_ON_EXAMPLE,),
        requirements=account_settings_guards(
            _SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.CHAT, roles=EDITOR_ROLES
        ),
        body=ChatWebAppPatch,
        returns=(HTTPStatus.OK, ChatWebApp, "Web app"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: ChatWebAppPatch):
        return settings.update_webapp(ctx, body, ChatWebApp, WebAppPath.CHAT)


@openapi_ns.route("/apps/<string:app_id>/webapp/chat:reset")
class ChatWebAppResetApi(Resource):
    @endpoint(
        op="reset.webapp.chat",
        kind=Kind.OBJECT,
        summary="Rotate a chat app's web app URL; the old URL stops working",
        examples=(_RESET_EXAMPLE,),
        requirements=account_settings_guards(
            _SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.CHAT, roles=ADMIN_ROLES
        ),
        returns=(HTTPStatus.OK, WebAppToken, "New URL token"),
    )
    def post(self, ctx: Context, app_id: str):
        return settings.reset_webapp(ctx, WebAppPath.CHAT)


@openapi_ns.route("/apps/<string:app_id>/webapp-access/chat")
class ChatWebAppAccessApi(Resource):
    @endpoint(
        op="describe.webapp_access.chat",
        kind=Kind.OBJECT,
        summary="Who may open a chat app's web app (Enterprise)",
        examples=(_ACCESS_EXAMPLE,),
        requirements=(
            *account_settings_guards(_ACCESS, scope=Scope.APPS_READ, mode=AppMode.CHAT, roles=EDITOR_ROLES),
            CheckWebAppAuthEnterprise(),
        ),
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp_access(ctx)

    @endpoint(
        op="set.webapp_access.chat",
        kind=Kind.OBJECT,
        summary="Set who may open a chat app's web app (Enterprise)",
        examples=(_ACCESS_SET_EXAMPLE,),
        requirements=(
            *account_settings_guards(_ACCESS, scope=Scope.WORKSPACE_WRITE, mode=AppMode.CHAT, roles=EDITOR_ROLES),
            CheckWebAppAuthEnterprise(),
        ),
        body=WebAppAccessPayload,
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def put(self, ctx: Context, app_id: str, *, body: WebAppAccessPayload):
        return settings.update_webapp_access(ctx, body)


@openapi_ns.route("/apps/<string:app_id>/webapp/agent-chat")
class AgentChatWebAppApi(Resource):
    @endpoint(
        op="describe.webapp.agent_chat",
        kind=Kind.OBJECT,
        summary="An agent-chat app's web app: on or off, its URL token and page settings",
        examples=(_WEBAPP_EXAMPLE,),
        requirements=account_settings_guards(_SITE_READ, scope=Scope.APPS_READ, mode=AppMode.AGENT_CHAT, roles=None),
        returns=(HTTPStatus.OK, ChatWebApp, "Web app"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp(ctx, ChatWebApp, WebAppPath.CHAT)

    @endpoint(
        op="set.webapp.agent_chat",
        kind=Kind.OBJECT,
        summary="Change an agent-chat app's web app; only the fields passed change",
        examples=(_WEBAPP_ON_EXAMPLE,),
        requirements=account_settings_guards(
            _SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.AGENT_CHAT, roles=EDITOR_ROLES
        ),
        body=ChatWebAppPatch,
        returns=(HTTPStatus.OK, ChatWebApp, "Web app"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: ChatWebAppPatch):
        return settings.update_webapp(ctx, body, ChatWebApp, WebAppPath.CHAT)


@openapi_ns.route("/apps/<string:app_id>/webapp/agent-chat:reset")
class AgentChatWebAppResetApi(Resource):
    @endpoint(
        op="reset.webapp.agent_chat",
        kind=Kind.OBJECT,
        summary="Rotate an agent-chat app's web app URL; the old URL stops working",
        examples=(_RESET_EXAMPLE,),
        requirements=account_settings_guards(
            _SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.AGENT_CHAT, roles=ADMIN_ROLES
        ),
        returns=(HTTPStatus.OK, WebAppToken, "New URL token"),
    )
    def post(self, ctx: Context, app_id: str):
        return settings.reset_webapp(ctx, WebAppPath.CHAT)


@openapi_ns.route("/apps/<string:app_id>/webapp-access/agent-chat")
class AgentChatWebAppAccessApi(Resource):
    @endpoint(
        op="describe.webapp_access.agent_chat",
        kind=Kind.OBJECT,
        summary="Who may open an agent-chat app's web app (Enterprise)",
        examples=(_ACCESS_EXAMPLE,),
        requirements=(
            *account_settings_guards(_ACCESS, scope=Scope.APPS_READ, mode=AppMode.AGENT_CHAT, roles=EDITOR_ROLES),
            CheckWebAppAuthEnterprise(),
        ),
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp_access(ctx)

    @endpoint(
        op="set.webapp_access.agent_chat",
        kind=Kind.OBJECT,
        summary="Set who may open an agent-chat app's web app (Enterprise)",
        examples=(_ACCESS_SET_EXAMPLE,),
        requirements=(
            *account_settings_guards(_ACCESS, scope=Scope.WORKSPACE_WRITE, mode=AppMode.AGENT_CHAT, roles=EDITOR_ROLES),
            CheckWebAppAuthEnterprise(),
        ),
        body=WebAppAccessPayload,
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def put(self, ctx: Context, app_id: str, *, body: WebAppAccessPayload):
        return settings.update_webapp_access(ctx, body)


@openapi_ns.route("/apps/<string:app_id>/webapp/completion")
class CompletionWebAppApi(Resource):
    @endpoint(
        op="describe.webapp.completion",
        kind=Kind.OBJECT,
        summary="A completion app's web app: on or off, its URL token and page settings",
        examples=(_WEBAPP_EXAMPLE,),
        requirements=account_settings_guards(_SITE_READ, scope=Scope.APPS_READ, mode=AppMode.COMPLETION, roles=None),
        returns=(HTTPStatus.OK, WebApp, "Web app"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp(ctx, WebApp, WebAppPath.COMPLETION)

    @endpoint(
        op="set.webapp.completion",
        kind=Kind.OBJECT,
        summary="Change a completion app's web app; only the fields passed change",
        examples=(_WEBAPP_ON_EXAMPLE,),
        requirements=account_settings_guards(
            _SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.COMPLETION, roles=EDITOR_ROLES
        ),
        body=WebAppPatch,
        returns=(HTTPStatus.OK, WebApp, "Web app"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: WebAppPatch):
        return settings.update_webapp(ctx, body, WebApp, WebAppPath.COMPLETION)


@openapi_ns.route("/apps/<string:app_id>/webapp/completion:reset")
class CompletionWebAppResetApi(Resource):
    @endpoint(
        op="reset.webapp.completion",
        kind=Kind.OBJECT,
        summary="Rotate a completion app's web app URL; the old URL stops working",
        examples=(_RESET_EXAMPLE,),
        requirements=account_settings_guards(
            _SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.COMPLETION, roles=ADMIN_ROLES
        ),
        returns=(HTTPStatus.OK, WebAppToken, "New URL token"),
    )
    def post(self, ctx: Context, app_id: str):
        return settings.reset_webapp(ctx, WebAppPath.COMPLETION)


@openapi_ns.route("/apps/<string:app_id>/webapp-access/completion")
class CompletionWebAppAccessApi(Resource):
    @endpoint(
        op="describe.webapp_access.completion",
        kind=Kind.OBJECT,
        summary="Who may open a completion app's web app (Enterprise)",
        examples=(_ACCESS_EXAMPLE,),
        requirements=(
            *account_settings_guards(_ACCESS, scope=Scope.APPS_READ, mode=AppMode.COMPLETION, roles=EDITOR_ROLES),
            CheckWebAppAuthEnterprise(),
        ),
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp_access(ctx)

    @endpoint(
        op="set.webapp_access.completion",
        kind=Kind.OBJECT,
        summary="Set who may open a completion app's web app (Enterprise)",
        examples=(_ACCESS_SET_EXAMPLE,),
        requirements=(
            *account_settings_guards(_ACCESS, scope=Scope.WORKSPACE_WRITE, mode=AppMode.COMPLETION, roles=EDITOR_ROLES),
            CheckWebAppAuthEnterprise(),
        ),
        body=WebAppAccessPayload,
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def put(self, ctx: Context, app_id: str, *, body: WebAppAccessPayload):
        return settings.update_webapp_access(ctx, body)


@openapi_ns.route("/apps/<string:app_id>/webapp/agent")
class AgentWebAppApi(Resource):
    @endpoint(
        op="describe.webapp.agent",
        kind=Kind.OBJECT,
        summary="An agent app's web app: on or off, its URL token and page settings",
        examples=(_WEBAPP_EXAMPLE,),
        requirements=account_settings_guards(_AGENT_SITE_READ, scope=Scope.APPS_READ, mode=AppMode.AGENT, roles=None),
        returns=(HTTPStatus.OK, AgentWebApp, "Web app"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp(ctx, AgentWebApp, WebAppPath.AGENT)

    @endpoint(
        op="set.webapp.agent",
        kind=Kind.OBJECT,
        summary="Change an agent app's web app; only the fields passed change",
        examples=(_WEBAPP_ON_EXAMPLE,),
        requirements=account_settings_guards(
            _AGENT_SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.AGENT, roles=EDITOR_ROLES
        ),
        body=ChatWebAppPatch,
        returns=(HTTPStatus.OK, AgentWebApp, "Web app"),
    )
    def patch(self, ctx: Context, app_id: str, *, body: ChatWebAppPatch):
        return settings.update_webapp(ctx, body, AgentWebApp, WebAppPath.AGENT)


@openapi_ns.route("/apps/<string:app_id>/webapp/agent:reset")
class AgentWebAppResetApi(Resource):
    @endpoint(
        op="reset.webapp.agent",
        kind=Kind.OBJECT,
        summary="Rotate an agent app's web app URL; the old URL stops working",
        examples=(_RESET_EXAMPLE,),
        requirements=account_settings_guards(
            _AGENT_SITE_WRITE, scope=Scope.WORKSPACE_WRITE, mode=AppMode.AGENT, roles=ADMIN_ROLES
        ),
        returns=(HTTPStatus.OK, WebAppToken, "New URL token"),
    )
    def post(self, ctx: Context, app_id: str):
        return settings.reset_webapp(ctx, WebAppPath.AGENT)


@openapi_ns.route("/apps/<string:app_id>/webapp-access/agent")
class AgentWebAppAccessApi(Resource):
    @endpoint(
        op="describe.webapp_access.agent",
        kind=Kind.OBJECT,
        summary="Who may open an agent app's web app (Enterprise)",
        examples=(_ACCESS_EXAMPLE,),
        requirements=(
            *account_settings_guards(_AGENT_ACCESS, scope=Scope.APPS_READ, mode=AppMode.AGENT, roles=EDITOR_ROLES),
            CheckWebAppAuthEnterprise(),
        ),
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def get(self, ctx: Context, app_id: str):
        return settings.webapp_access(ctx)

    @endpoint(
        op="set.webapp_access.agent",
        kind=Kind.OBJECT,
        summary="Set who may open an agent app's web app (Enterprise)",
        examples=(_ACCESS_SET_EXAMPLE,),
        requirements=(
            *account_settings_guards(
                _AGENT_ACCESS, scope=Scope.WORKSPACE_WRITE, mode=AppMode.AGENT, roles=EDITOR_ROLES
            ),
            CheckWebAppAuthEnterprise(),
        ),
        body=WebAppAccessPayload,
        returns=(HTTPStatus.OK, WebAppAccess, "Web-app access"),
    )
    def put(self, ctx: Context, app_id: str, *, body: WebAppAccessPayload):
        return settings.update_webapp_access(ctx, body)
