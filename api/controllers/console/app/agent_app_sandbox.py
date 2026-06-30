"""Console routes for Agent App and workflow Agent sandbox file access.

The API keeps product-facing locators (conversation or workflow node identity)
on this public boundary and proxies list/read/upload to the agent backend's new
``/sandbox`` contract.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from dify_agent.client import DifyAgentClientError, DifyAgentHTTPError, DifyAgentTimeoutError
from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.agent.app_helpers import resolve_agent_runtime_app_model
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required, with_current_tenant_id
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.login import login_required
from models.model import App, AppMode
from services.agent_app_sandbox_service import (
    AgentAppSandboxService,
    AgentSandboxInspectorError,
    WorkflowAgentSandboxService,
)

_NODE_EXECUTION_ID_DESCRIPTION = (
    "Optional workflow node execution ID. When omitted, the latest active session for the node is used."
)


class AgentSandboxListQuery(BaseModel):
    conversation_id: str = Field(min_length=1, description="Agent App conversation ID")
    path: str = Field(default=".", description="Directory path relative to the sandbox workspace")


class AgentSandboxFileQuery(BaseModel):
    conversation_id: str = Field(min_length=1, description="Agent App conversation ID")
    path: str = Field(min_length=1, description="File path relative to the sandbox workspace")


class AgentSandboxUploadPayload(BaseModel):
    conversation_id: str = Field(min_length=1, description="Agent App conversation ID")
    path: str = Field(min_length=1, description="File path relative to the sandbox workspace")


class WorkflowAgentSandboxListQuery(BaseModel):
    path: str = Field(default=".", description="Directory path relative to the sandbox workspace")
    node_execution_id: str | None = Field(
        default=None,
        description=_NODE_EXECUTION_ID_DESCRIPTION,
    )


class WorkflowAgentSandboxFileQuery(BaseModel):
    path: str = Field(min_length=1, description="File path relative to the sandbox workspace")
    node_execution_id: str | None = Field(
        default=None,
        description=_NODE_EXECUTION_ID_DESCRIPTION,
    )


class WorkflowAgentSandboxUploadPayload(BaseModel):
    path: str = Field(min_length=1, description="File path relative to the sandbox workspace")
    node_execution_id: str | None = Field(
        default=None,
        description=_NODE_EXECUTION_ID_DESCRIPTION,
    )


class SandboxFileEntryResponse(ResponseModel):
    name: str
    type: Literal["file", "dir", "symlink", "other"]
    size: int | None = None
    mtime: int | None = None


class SandboxListResponse(ResponseModel):
    path: str
    entries: list[SandboxFileEntryResponse] = Field(default_factory=list)
    truncated: bool = False


class SandboxReadResponse(ResponseModel):
    path: str
    size: int | None = None
    truncated: bool
    binary: bool
    text: str | None = None


class SandboxToolFileResponse(ResponseModel):
    transfer_method: Literal["tool_file"] = "tool_file"
    reference: str


class SandboxUploadResponse(ResponseModel):
    path: str
    file: SandboxToolFileResponse


register_schema_models(
    console_ns,
    AgentSandboxUploadPayload,
    WorkflowAgentSandboxUploadPayload,
)
register_response_schema_models(console_ns, SandboxListResponse, SandboxReadResponse, SandboxUploadResponse)


def _handle(exc: Exception) -> tuple[dict[str, object], int]:
    if isinstance(exc, AgentSandboxInspectorError):
        return {"code": exc.code, "message": exc.message}, exc.status_code
    if isinstance(exc, DifyAgentHTTPError):
        detail = exc.detail
        if isinstance(detail, dict):
            return {
                "code": detail.get("code", "agent_backend_error"),
                "message": detail.get("message", str(exc)),
            }, exc.status_code
        return {"code": "agent_backend_error", "message": str(detail)}, exc.status_code
    if isinstance(exc, DifyAgentTimeoutError | DifyAgentClientError):
        return {"code": "agent_backend_unreachable", "message": str(exc)}, 502
    raise exc


@console_ns.route("/agent/<uuid:agent_id>/sandbox/files")
class AgentAppSandboxListResource(Resource):
    @console_ns.doc("list_agent_app_sandbox_files")
    @console_ns.doc(description="List a directory in an Agent App conversation sandbox")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentSandboxListQuery)})
    @console_ns.response(200, "Listing returned", console_ns.models[SandboxListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID):
        app_model = resolve_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
        query = query_params_from_request(AgentSandboxListQuery)
        try:
            result = AgentAppSandboxService().list_files(
                tenant_id=tenant_id,
                app_id=app_model.id,
                conversation_id=query.conversation_id,
                path=query.path,
            )
        except Exception as exc:
            return _handle(exc)
        return result.model_dump()


@console_ns.route("/agent/<uuid:agent_id>/sandbox/files/read")
class AgentAppSandboxReadResource(Resource):
    @console_ns.doc("read_agent_app_sandbox_file")
    @console_ns.doc(description="Read a text/binary preview file in an Agent App conversation sandbox")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentSandboxFileQuery)})
    @console_ns.response(200, "Preview returned", console_ns.models[SandboxReadResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID):
        app_model = resolve_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
        query = query_params_from_request(AgentSandboxFileQuery)
        try:
            result = AgentAppSandboxService().read_file(
                tenant_id=tenant_id,
                app_id=app_model.id,
                conversation_id=query.conversation_id,
                path=query.path,
            )
        except Exception as exc:
            return _handle(exc)
        return result.model_dump()


@console_ns.route("/agent/<uuid:agent_id>/sandbox/files/upload")
class AgentAppSandboxUploadResource(Resource):
    @console_ns.doc("upload_agent_app_sandbox_file")
    @console_ns.doc(description="Upload one Agent App sandbox file as a Dify ToolFile mapping")
    @console_ns.expect(console_ns.models[AgentSandboxUploadPayload.__name__])
    @console_ns.response(200, "Uploaded", console_ns.models[SandboxUploadResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, agent_id: UUID):
        app_model = resolve_agent_runtime_app_model(tenant_id=tenant_id, agent_id=agent_id)
        payload = AgentSandboxUploadPayload.model_validate(request.get_json(silent=True) or {})
        try:
            result = AgentAppSandboxService().upload_file(
                tenant_id=tenant_id,
                app_id=app_model.id,
                conversation_id=payload.conversation_id,
                path=payload.path,
            )
        except Exception as exc:
            return _handle(exc)
        return result.model_dump()


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
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @with_current_tenant_id
    def get(self, tenant_id: str, app_model: App, workflow_run_id: UUID, node_id: str):
        query = query_params_from_request(WorkflowAgentSandboxListQuery)
        try:
            result = WorkflowAgentSandboxService().list_files(
                tenant_id=tenant_id,
                app_id=app_model.id,
                workflow_run_id=str(workflow_run_id),
                node_id=node_id,
                node_execution_id=query.node_execution_id,
                path=query.path,
                session=db.session,
            )
        except Exception as exc:
            return _handle(exc)
        return result.model_dump()


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
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @with_current_tenant_id
    def get(self, tenant_id: str, app_model: App, workflow_run_id: UUID, node_id: str):
        query = query_params_from_request(WorkflowAgentSandboxFileQuery)
        try:
            result = WorkflowAgentSandboxService().read_file(
                tenant_id=tenant_id,
                app_id=app_model.id,
                workflow_run_id=str(workflow_run_id),
                node_id=node_id,
                node_execution_id=query.node_execution_id,
                path=query.path,
                session=db.session,
            )
        except Exception as exc:
            return _handle(exc)
        return result.model_dump()


@console_ns.route(
    "/apps/<uuid:app_id>/workflow-runs/<uuid:workflow_run_id>/agent-nodes/<string:node_id>/sandbox/files/upload"
)
class WorkflowAgentSandboxUploadResource(Resource):
    @console_ns.doc("upload_workflow_agent_sandbox_file")
    @console_ns.doc(description="Upload one workflow Agent sandbox file as a Dify ToolFile mapping")
    @console_ns.expect(console_ns.models[WorkflowAgentSandboxUploadPayload.__name__])
    @console_ns.response(200, "Uploaded", console_ns.models[SandboxUploadResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @with_current_tenant_id
    def post(self, tenant_id: str, app_model: App, workflow_run_id: UUID, node_id: str):
        payload = WorkflowAgentSandboxUploadPayload.model_validate(request.get_json(silent=True) or {})
        try:
            result = WorkflowAgentSandboxService().upload_file(
                tenant_id=tenant_id,
                app_id=app_model.id,
                workflow_run_id=str(workflow_run_id),
                node_id=node_id,
                node_execution_id=payload.node_execution_id,
                path=payload.path,
                session=db.session,
            )
        except Exception as exc:
            return _handle(exc)
        return result.model_dump()
