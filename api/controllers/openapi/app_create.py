"""Create blank workflow and advanced-chat apps with an empty draft; export then gives the starting DSL."""

from __future__ import annotations

from http import HTTPStatus
from typing import Final, Literal

from flask_restx import Resource

from controllers.common.rbac import RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._models import CreateAppPayload, CreatedAppResponse
from controllers.openapi.auth.requirements import EDITOR_ROLES, CheckAppQuota, workspace_write_guards
from extensions.ext_application_services import application_services
from machinery.context import RequestContext
from models import AppMode
from services.entities.app_entities import CreateAppParams

_CREATE_GUARDS: Final = workspace_write_guards(
    RBACPermission.APP_CREATE_AND_MANAGEMENT, roles=EDITOR_ROLES, extra=(CheckAppQuota(),)
)


def _create(
    ctx: RequestContext, mode: Literal[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT], body: CreateAppPayload
) -> tuple[CreatedAppResponse, HTTPStatus]:
    console = application_services().apps.console
    app = console.create(ctx, CreateAppParams(mode=mode.value, **body.model_dump(exclude_none=True)))
    console.create_draft(ctx, app.id)
    return CreatedAppResponse(app_id=app.id, mode=mode.value, name=app.name), HTTPStatus.CREATED


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/workflow")
class WorkflowAppCreateApi(Resource):
    @endpoint(
        account_context=True,
        op="create.console_app.workflow",
        kind=Kind.OBJECT,
        summary="Create a blank workflow app; export its DSL to start building",
        examples=(Example(title="Create a workflow app", input={"name": "Release notes"}),),
        requirements=_CREATE_GUARDS,
        body=CreateAppPayload,
        returns=(HTTPStatus.CREATED, CreatedAppResponse, "Created"),
    )
    def post(self, ctx: RequestContext, workspace_id: str, *, body: CreateAppPayload):
        return _create(ctx, AppMode.WORKFLOW, body)


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/advanced-chat")
class AdvancedChatAppCreateApi(Resource):
    @endpoint(
        account_context=True,
        op="create.console_app.advanced_chat",
        kind=Kind.OBJECT,
        summary="Create a blank advanced-chat app; export its DSL to start building",
        examples=(Example(title="Create an advanced-chat app", input={"name": "Support bot"}),),
        requirements=_CREATE_GUARDS,
        body=CreateAppPayload,
        returns=(HTTPStatus.CREATED, CreatedAppResponse, "Created"),
    )
    def post(self, ctx: RequestContext, workspace_id: str, *, body: CreateAppPayload):
        return _create(ctx, AppMode.ADVANCED_CHAT, body)
