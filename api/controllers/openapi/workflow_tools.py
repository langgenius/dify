"""Workflow tools — workspace workflow apps published as tool providers."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from http import HTTPStatus
from typing import Final

from flask_restx import Resource
from werkzeug.exceptions import BadRequest

from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Effect, Example, Kind, endpoint
from controllers.openapi._errors import ProviderNotFound
from controllers.openapi._models import (
    WorkflowToolCreatePayload,
    WorkflowToolResponse,
    WorkflowToolSetPayload,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import ADMIN_ROLES, WORKSPACE_READ_GUARDS, workspace_write_guards
from services.tools.workflow_tools_manage_service import WorkflowToolManageService

_COLLECTION: Final = "/workspaces/<string:workspace_id>/workflow-tools"
_ITEM: Final = f"{_COLLECTION}/<string:workflow_tool_id>"

_MANAGE: Final = workspace_write_guards(RBACPermission.TOOL_MANAGE, roles=ADMIN_ROLES)


@contextmanager
def _workflow_tool_errors() -> Generator[None]:
    """Every service `ValueError` answers 400; a missing tool is caught earlier
    by `_require_tool` and answers 404."""
    try:
        yield
    except ValueError as error:
        raise BadRequest(str(error)) from error


def _require_tool(ctx: Context, workflow_tool_id: str) -> None:
    """Raise ProviderNotFound when `workflow_tool_id` names no workflow tool of the workspace."""
    tools = WorkflowToolManageService.list_tenant_workflow_tools(ctx.account.id, ctx.workspace.id)
    if all(tool.id != workflow_tool_id for tool in tools):
        raise ProviderNotFound("Tool not found")


def _describe(ctx: Context, workflow_tool_id: str) -> WorkflowToolResponse:
    _require_tool(ctx, workflow_tool_id)
    with _workflow_tool_errors():
        tool = WorkflowToolManageService.get_workflow_tool_by_tool_id(
            ctx.account.id, ctx.workspace.id, workflow_tool_id
        )
    return WorkflowToolResponse.model_validate(tool)


def _describe_by_app(ctx: Context, workflow_app_id: str) -> WorkflowToolResponse:
    with _workflow_tool_errors():
        tool = WorkflowToolManageService.get_workflow_tool_by_app_id(ctx.account.id, ctx.workspace.id, workflow_app_id)
    return WorkflowToolResponse.model_validate(tool)


@openapi_ns.route(_COLLECTION)
class WorkflowToolsApi(Resource):
    @endpoint(
        op="create.workflow_tool",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Publish a workflow app as a tool",
        examples=(
            Example(
                title="A summarizer tool",
                input={
                    "workflow_app_id": "<app_id>",
                    "name": "summarizer",
                    "label": "Summarizer",
                    "icon": {"background": "#252525", "content": "\U0001f4dd"},
                    "description": "Summarize a document",
                    "parameters": [],
                },
            ),
        ),
        requirements=_MANAGE,
        body=WorkflowToolCreatePayload,
        returns=(HTTPStatus.CREATED, WorkflowToolResponse, "Workflow tool created"),
    )
    def post(self, ctx: Context, workspace_id: str, *, body: WorkflowToolCreatePayload):
        """Publish a workflow app as a tool.

        `workflow_app_id` names a workflow app whose published workflow backs
        the tool. Answers 400 for a duplicate name or app id, an unknown app,
        or an app without a published workflow.
        """
        with _workflow_tool_errors():
            WorkflowToolManageService.create_workflow_tool(
                user_id=ctx.account.id,
                tenant_id=ctx.workspace.id,
                workflow_app_id=body.workflow_app_id,
                name=body.name,
                label=body.label,
                icon=body.icon.model_dump(mode="json"),
                description=body.description,
                parameters=body.parameters,
                privacy_policy=body.privacy_policy or "",
                labels=body.labels or [],
            )
        return _describe_by_app(ctx, body.workflow_app_id), HTTPStatus.CREATED


@openapi_ns.route(_ITEM)
class WorkflowToolApi(Resource):
    @endpoint(
        op="describe.workflow_tool",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="One workflow tool",
        examples=(Example(title="The summarizer tool", input={"workflow_tool_id": "<workflow_tool_id>"}),),
        requirements=WORKSPACE_READ_GUARDS,
        returns=(HTTPStatus.OK, WorkflowToolResponse, "Workflow tool"),
    )
    def get(self, ctx: Context, workspace_id: str, workflow_tool_id: str):
        """Read one workflow tool.

        `synced` is false once the app's published workflow moved past the
        version this tool captured. Answers 404 when `workflow_tool_id` names
        no tool.
        """
        return _describe(ctx, workflow_tool_id)

    @endpoint(
        op="set.workflow_tool",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Replace a workflow tool",
        examples=(
            Example(
                title="Rename the summarizer",
                input={
                    "workflow_tool_id": "<workflow_tool_id>",
                    "name": "summarizer-v2",
                    "label": "Summarizer v2",
                    "icon": {"background": "#252525", "content": "\U0001f4dd"},
                    "description": "Summarize a document",
                    "parameters": [],
                },
            ),
        ),
        requirements=_MANAGE,
        body=WorkflowToolSetPayload,
        returns=(HTTPStatus.OK, WorkflowToolResponse, "Workflow tool replaced"),
    )
    def put(self, ctx: Context, workspace_id: str, workflow_tool_id: str, *, body: WorkflowToolSetPayload):
        """Replace a workflow tool.

        Full replace: name, label, icon, description, parameters, privacy
        policy, and labels become the request's. The tool keeps backing the
        same workflow app. Answers 404 when `workflow_tool_id` names no tool
        and 400 for a duplicate name or an app whose published workflow is
        gone.
        """
        _require_tool(ctx, workflow_tool_id)
        with _workflow_tool_errors():
            WorkflowToolManageService.update_workflow_tool(
                ctx.account.id,
                ctx.workspace.id,
                workflow_tool_id,
                body.name,
                body.label,
                body.icon.model_dump(mode="json"),
                body.description,
                body.parameters,
                body.privacy_policy or "",
                body.labels or [],
            )
        return _describe(ctx, workflow_tool_id)

    @endpoint(
        op="delete.workflow_tool",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Unpublish a workflow tool",
        examples=(Example(title="Remove the summarizer", input={"workflow_tool_id": "<workflow_tool_id>"}),),
        requirements=_MANAGE,
        returns=(HTTPStatus.OK, SimpleResultResponse, "Workflow tool deleted"),
    )
    def delete(self, ctx: Context, workspace_id: str, workflow_tool_id: str):
        """Unpublish a workflow tool.

        Apps that used the tool lose it; the workflow app itself is
        untouched. Answers 404 when `workflow_tool_id` names no tool.
        """
        _require_tool(ctx, workflow_tool_id)
        with _workflow_tool_errors():
            WorkflowToolManageService.delete_workflow_tool(ctx.account.id, ctx.workspace.id, workflow_tool_id)
        return SimpleResultResponse(result="success")
