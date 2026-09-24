"""Console routes for Agent App and workflow Agent sandbox file access.

The API accepts product-facing Conversation, Build Draft, or Workflow Node
Execution locators and proxies list/read/download to the agent backend's
``/execution-bindings/files`` contract.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from dify_agent.client import DifyAgentClientError, DifyAgentHTTPError
from flask_restx import Resource
from pydantic import BaseModel, Field

from clients.agent_backend.errors import backend_error_detail, backend_reported_failure
from controllers.common.rbac import AgentId, PlainApp, RBACCheck
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, validate_request
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from services.agent.errors import AgentNotFoundError
from services.app.agent_app_contracts import (
    AgentAppNotFoundError,
    AgentSandboxBindingNotFoundError,
    AgentSandboxCaller,
    AgentSandboxDownloadUnavailableError,
    AgentSandboxUnavailableError,
    WorkflowSandboxAppNotFoundError,
    WorkflowSandboxCaller,
)

_BINDING_PATH_DESCRIPTION = (
    "Binding path: relative paths start in Workspace; exact `~` and paths beginning with `~/` start in Home; "
    "`~user` is an ordinary relative path from Workspace; absolute paths remain absolute; `..` and paths outside "
    "Workspace are governed by backend isolation, not a Workspace-root restriction"
)


class AgentSandboxListQuery(BaseModel):
    caller_type: Literal["conversation", "build_draft"]
    caller_id: str = Field(min_length=1, description="Agent App caller ID")
    path: str = Field(default=".", description=_BINDING_PATH_DESCRIPTION)


class AgentSandboxInfoQuery(BaseModel):
    caller_type: Literal["conversation", "build_draft"]
    caller_id: str = Field(min_length=1, description="Agent App caller ID")


class AgentSandboxFileQuery(BaseModel):
    caller_type: Literal["conversation", "build_draft"]
    caller_id: str = Field(min_length=1, description="Agent App caller ID")
    path: str = Field(min_length=1, description=_BINDING_PATH_DESCRIPTION)


class AgentSandboxDownloadPayload(BaseModel):
    caller_type: Literal["conversation", "build_draft"]
    caller_id: str = Field(min_length=1, description="Agent App caller ID")
    path: str = Field(min_length=1, description=_BINDING_PATH_DESCRIPTION)


class WorkflowAgentSandboxListQuery(BaseModel):
    node_execution_id: str = Field(min_length=1, description="Workflow node execution ID")
    path: str = Field(default=".", description=_BINDING_PATH_DESCRIPTION)


class WorkflowAgentSandboxFileQuery(BaseModel):
    node_execution_id: str = Field(min_length=1, description="Workflow node execution ID")
    path: str = Field(min_length=1, description=_BINDING_PATH_DESCRIPTION)


class WorkflowAgentSandboxDownloadPayload(BaseModel):
    node_execution_id: str = Field(min_length=1, description="Workflow node execution ID")
    path: str = Field(min_length=1, description=_BINDING_PATH_DESCRIPTION)


class SandboxFileEntryResponse(ResponseModel):
    name: str
    type: Literal["file", "dir", "symlink", "other"]
    size: int | None = None
    mtime: int | None = None


class SandboxListResponse(ResponseModel):
    path: str
    entries: list[SandboxFileEntryResponse] = Field(default_factory=list)
    truncated: bool = False


class SandboxInfoResponse(ResponseModel):
    workspace_cwd: str


class SandboxReadResponse(ResponseModel):
    path: str
    size: int | None = None
    truncated: bool
    binary: bool
    text: str | None = None


class SandboxDownloadResponse(ResponseModel):
    url: str


register_schema_models(
    console_ns,
    AgentSandboxDownloadPayload,
    WorkflowAgentSandboxDownloadPayload,
)
register_response_schema_models(
    console_ns,
    SandboxInfoResponse,
    SandboxListResponse,
    SandboxReadResponse,
    SandboxDownloadResponse,
)


def _handle(exc: Exception) -> tuple[dict[str, object], int]:
    if isinstance(exc, AgentAppNotFoundError):
        raise AgentNotFoundError from exc
    if isinstance(exc, WorkflowSandboxAppNotFoundError):
        raise AppNotFoundError from exc
    if isinstance(exc, AgentSandboxBindingNotFoundError):
        return {"code": "no_active_binding", "message": str(exc)}, 404
    if isinstance(exc, AgentSandboxUnavailableError):
        return {"code": "inspector_unavailable", "message": str(exc)}, 503
    if isinstance(exc, AgentSandboxDownloadUnavailableError):
        return {"code": "binding_file_download_unavailable", "message": str(exc)}, 502
    if isinstance(exc, DifyAgentHTTPError) and backend_reported_failure(exc):
        code, message = backend_error_detail(exc)
        return {"code": code, "message": message}, exc.status_code
    if isinstance(exc, DifyAgentClientError):
        return {"code": "agent_backend_unreachable", "message": str(exc)}, 502
    raise exc


@console_ns.route("/agent/<uuid:agent_id>/sandbox")
class AgentAppSandboxInfoResource(Resource):
    @console_ns.doc("get_agent_app_sandbox_info")
    @console_ns.doc(description="Get basic information for an Agent App conversation sandbox")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentSandboxInfoQuery)})
    @console_ns.response(200, "Sandbox information returned", console_ns.models[SandboxInfoResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId()),))
    def get(self, context: RequestContext, agent_id: UUID):
        query = query_params_from_request(AgentSandboxInfoQuery)
        try:
            result = application_services().agent_apps.sandbox.get_info(
                context, AgentSandboxCaller(str(agent_id), query.caller_type, query.caller_id)
            )
        except Exception as exc:
            return _handle(exc)
        return dump_response(SandboxInfoResponse, result)


@console_ns.route("/agent/<uuid:agent_id>/sandbox/files")
class AgentAppSandboxListResource(Resource):
    @console_ns.doc("list_agent_app_sandbox_files")
    @console_ns.doc(description="List a directory in an Agent App conversation sandbox")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentSandboxListQuery)})
    @console_ns.response(200, "Listing returned", console_ns.models[SandboxListResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId()),))
    def get(self, context: RequestContext, agent_id: UUID):
        query = query_params_from_request(AgentSandboxListQuery)
        try:
            result = application_services().agent_apps.sandbox.list_files(
                context, AgentSandboxCaller(str(agent_id), query.caller_type, query.caller_id), query.path
            )
        except Exception as exc:
            return _handle(exc)
        return dump_response(SandboxListResponse, result)


@console_ns.route("/agent/<uuid:agent_id>/sandbox/files/read")
class AgentAppSandboxReadResource(Resource):
    @console_ns.doc("read_agent_app_sandbox_file")
    @console_ns.doc(description="Read a text/binary preview file in an Agent App conversation sandbox")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentSandboxFileQuery)})
    @console_ns.response(200, "Preview returned", console_ns.models[SandboxReadResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.AGENT_PREVIEW, AgentId()),))
    def get(self, context: RequestContext, agent_id: UUID):
        query = query_params_from_request(AgentSandboxFileQuery)
        try:
            result = application_services().agent_apps.sandbox.read_file(
                context, AgentSandboxCaller(str(agent_id), query.caller_type, query.caller_id), query.path
            )
        except Exception as exc:
            return _handle(exc)
        return dump_response(SandboxReadResponse, result)


@console_ns.route("/agent/<uuid:agent_id>/sandbox/files/download")
class AgentAppSandboxDownloadResource(Resource):
    @console_ns.doc("download_agent_app_sandbox_file")
    @console_ns.doc(description="Create a ToolFile from one Agent App Binding file and return its download URL")
    @console_ns.expect(console_ns.models[AgentSandboxDownloadPayload.__name__])
    @console_ns.response(200, "Download URL returned", console_ns.models[SandboxDownloadResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.AGENT_EDIT, AgentId()),))
    def post(self, context: RequestContext, agent_id: UUID):
        query = validate_request(AgentSandboxDownloadPayload)
        try:
            result = application_services().agent_apps.sandbox.download_file(
                context, AgentSandboxCaller(str(agent_id), query.caller_type, query.caller_id), query.path
            )
        except Exception as exc:
            return _handle(exc)
        return dump_response(SandboxDownloadResponse, result)


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<uuid:workflow_run_id>/agent-nodes/<string:node_id>/sandbox/files")
class WorkflowAgentSandboxListResource(Resource):
    @console_ns.doc("list_workflow_agent_sandbox_files")
    @console_ns.doc(description="List a directory in a workflow Agent node sandbox")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "workflow_run_id": "Workflow run ID",
            "node_id": "Workflow Agent node ID",
            **query_params_from_model(WorkflowAgentSandboxListQuery),
        }
    )
    @console_ns.response(200, "Listing returned", console_ns.models[SandboxListResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()),))
    def get(self, context: RequestContext, app_id: UUID, workflow_run_id: UUID, node_id: str):
        query = query_params_from_request(WorkflowAgentSandboxListQuery)
        try:
            result = application_services().agent_apps.sandbox.list_files(
                context,
                WorkflowSandboxCaller(str(app_id), str(workflow_run_id), node_id, query.node_execution_id),
                query.path,
            )
        except Exception as exc:
            return _handle(exc)
        return dump_response(SandboxListResponse, result)


@console_ns.route(
    "/apps/<uuid:app_id>/workflow-runs/<uuid:workflow_run_id>/agent-nodes/<string:node_id>/sandbox/files/read"
)
class WorkflowAgentSandboxReadResource(Resource):
    @console_ns.doc("read_workflow_agent_sandbox_file")
    @console_ns.doc(description="Read a text/binary preview file in a workflow Agent node sandbox")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "workflow_run_id": "Workflow run ID",
            "node_id": "Workflow Agent node ID",
            **query_params_from_model(WorkflowAgentSandboxFileQuery),
        }
    )
    @console_ns.response(200, "Preview returned", console_ns.models[SandboxReadResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()),))
    def get(self, context: RequestContext, app_id: UUID, workflow_run_id: UUID, node_id: str):
        query = query_params_from_request(WorkflowAgentSandboxFileQuery)
        try:
            result = application_services().agent_apps.sandbox.read_file(
                context,
                WorkflowSandboxCaller(str(app_id), str(workflow_run_id), node_id, query.node_execution_id),
                query.path,
            )
        except Exception as exc:
            return _handle(exc)
        return dump_response(SandboxReadResponse, result)


@console_ns.route(
    "/apps/<uuid:app_id>/workflow-runs/<uuid:workflow_run_id>/agent-nodes/<string:node_id>/sandbox/files/download"
)
class WorkflowAgentSandboxDownloadResource(Resource):
    @console_ns.doc("download_workflow_agent_sandbox_file")
    @console_ns.doc(description="Create a ToolFile from one workflow Agent Binding file and return its download URL")
    @console_ns.expect(console_ns.models[WorkflowAgentSandboxDownloadPayload.__name__])
    @console_ns.response(200, "Download URL returned", console_ns.models[SandboxDownloadResponse.__name__])
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()),))
    def post(self, context: RequestContext, app_id: UUID, workflow_run_id: UUID, node_id: str):
        query = validate_request(WorkflowAgentSandboxDownloadPayload)
        try:
            result = application_services().agent_apps.sandbox.download_file(
                context,
                WorkflowSandboxCaller(str(app_id), str(workflow_run_id), node_id, query.node_execution_id),
                query.path,
            )
        except Exception as exc:
            return _handle(exc)
        return dump_response(SandboxDownloadResponse, result)
