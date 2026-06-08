"""Agent App sandbox file-system inspector (read-only).

Exposes the PRD "rc1-like sandbox file system, downloadable not editable" view
for an Agent App conversation: list a directory, preview a file, or download a
file from the conversation's shell-layer workspace. The API never touches
shellctl directly — it resolves the conversation's sandbox ``session_id`` from
the stored session snapshot and proxies to the agent backend's read-only
workspace endpoints.
"""

from typing import Literal
from uuid import UUID

from flask import Response
from flask_restx import Resource, fields
from pydantic import BaseModel, Field

from clients.agent_backend.errors import AgentBackendHTTPError, AgentBackendTransportError
from clients.agent_backend.workspace_files_client import WorkspaceDownloadResult
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, rbac_permission_required, setup_required
from fields.base import ResponseModel
from libs.login import current_account_with_tenant, login_required
from models.model import App, AppMode
from services.agent_app_workspace_service import (
    AgentAppWorkspaceService,
    AgentWorkspaceInspectorError,
    WorkflowAgentWorkspaceService,
)


class _WorkspaceFileDownloadField(fields.Raw):
    __schema_type__ = "string"
    __schema_format__ = "binary"


class AgentWorkspaceListQuery(BaseModel):
    conversation_id: str = Field(min_length=1, description="Agent App conversation ID")
    path: str = Field(default=".", description="Directory path relative to the sandbox workspace")


class AgentWorkspaceFileQuery(BaseModel):
    conversation_id: str = Field(min_length=1, description="Agent App conversation ID")
    path: str = Field(min_length=1, description="File path relative to the sandbox workspace")


class WorkflowAgentWorkspaceListQuery(BaseModel):
    path: str = Field(default=".", description="Directory path relative to the sandbox workspace")
    node_execution_id: str | None = Field(
        default=None,
        description=(
            "Optional workflow node execution ID. When omitted, the latest active session for the node is used."
        ),
    )


class WorkflowAgentWorkspaceFileQuery(BaseModel):
    path: str = Field(min_length=1, description="File path relative to the sandbox workspace")
    node_execution_id: str | None = Field(
        default=None,
        description=(
            "Optional workflow node execution ID. When omitted, the latest active session for the node is used."
        ),
    )


class WorkspaceFileEntryResponse(ResponseModel):
    name: str
    type: Literal["file", "dir", "symlink"]
    size: int
    mtime: int


class WorkspaceListResponse(ResponseModel):
    path: str
    entries: list[WorkspaceFileEntryResponse] = Field(default_factory=list)
    truncated: bool = False


class WorkspacePreviewResponse(ResponseModel):
    path: str
    size: int
    truncated: bool
    binary: bool
    text: str | None = None


register_response_schema_models(console_ns, WorkspaceListResponse)
register_response_schema_models(console_ns, WorkspacePreviewResponse)


def _handle(exc: Exception) -> tuple[dict[str, object], int]:
    if isinstance(exc, AgentWorkspaceInspectorError):
        return {"code": exc.code, "message": exc.message}, exc.status_code
    if isinstance(exc, AgentBackendHTTPError):
        detail = exc.detail
        if isinstance(detail, dict):
            return {
                "code": detail.get("code", "agent_backend_error"),
                "message": detail.get("message", str(exc)),
            }, exc.status_code
        return {"code": "agent_backend_error", "message": str(detail)}, exc.status_code
    if isinstance(exc, AgentBackendTransportError):
        return {"code": "agent_backend_unreachable", "message": str(exc)}, 502
    raise exc


def _download_response(result: WorkspaceDownloadResult) -> Response | tuple[dict[str, object], int]:
    if result.truncated:
        return {
            "code": "workspace_file_too_large",
            "message": (
                "file exceeds the workspace download limit; use preview for partial text or download a smaller file"
            ),
            "size": result.size,
        }, 413
    filename = result.path.rsplit("/", 1)[-1] or "download"
    return Response(
        result.content,
        mimetype="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(result.content)),
            "X-Workspace-File-Size": str(result.size),
        },
    )


@console_ns.route("/apps/<uuid:app_id>/agent-workspace/files")
class AgentAppWorkspaceListResource(Resource):
    @console_ns.doc("list_agent_app_workspace_files")
    @console_ns.doc(description="List a directory in an Agent App conversation's sandbox workspace (read-only)")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentWorkspaceListQuery)})
    @console_ns.response(200, "Listing returned", console_ns.models[WorkspaceListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required("app", "app_create_and_management")
    @get_app_model(mode=[AppMode.AGENT])
    def get(self, app_model: App):
        _, tenant_id = current_account_with_tenant()
        query = query_params_from_request(AgentWorkspaceListQuery)
        try:
            result = AgentAppWorkspaceService().list_files(
                tenant_id=tenant_id,
                app_id=app_model.id,
                conversation_id=query.conversation_id,
                path=query.path,
            )
        except Exception as exc:  # normalized to an HTTP response below
            return _handle(exc)
        return result.model_dump()


@console_ns.route("/apps/<uuid:app_id>/agent-workspace/files/preview")
class AgentAppWorkspacePreviewResource(Resource):
    @console_ns.doc("preview_agent_app_workspace_file")
    @console_ns.doc(description="Preview a text/binary file in an Agent App conversation's sandbox workspace")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentWorkspaceFileQuery)})
    @console_ns.response(200, "Preview returned", console_ns.models[WorkspacePreviewResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required("app", "app_create_and_management")
    @get_app_model(mode=[AppMode.AGENT])
    def get(self, app_model: App):
        _, tenant_id = current_account_with_tenant()
        query = query_params_from_request(AgentWorkspaceFileQuery)
        try:
            result = AgentAppWorkspaceService().preview(
                tenant_id=tenant_id,
                app_id=app_model.id,
                conversation_id=query.conversation_id,
                path=query.path,
            )
        except Exception as exc:  # normalized to an HTTP response below
            return _handle(exc)
        return result.model_dump()


@console_ns.route("/apps/<uuid:app_id>/agent-workspace/files/download")
class AgentAppWorkspaceDownloadResource(Resource):
    @console_ns.doc("download_agent_app_workspace_file")
    @console_ns.doc(description="Download a file from an Agent App conversation's sandbox workspace (read-only)")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentWorkspaceFileQuery)})
    @console_ns.doc(produces=["application/octet-stream"])
    @console_ns.response(200, "File bytes", _WorkspaceFileDownloadField)
    @console_ns.response(413, "File exceeds the workspace download limit")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required("app", "app_create_and_management")
    @get_app_model(mode=[AppMode.AGENT])
    def get(self, app_model: App):
        _, tenant_id = current_account_with_tenant()
        query = query_params_from_request(AgentWorkspaceFileQuery)
        try:
            result = AgentAppWorkspaceService().download(
                tenant_id=tenant_id,
                app_id=app_model.id,
                conversation_id=query.conversation_id,
                path=query.path,
            )
        except Exception as exc:  # normalized to an HTTP response below
            return _handle(exc)
        return _download_response(result)


@console_ns.route(
    "/apps/<uuid:app_id>/workflow-runs/<uuid:workflow_run_id>/agent-nodes/<string:node_id>/workspace/files"
)
class WorkflowAgentWorkspaceListResource(Resource):
    @console_ns.doc("list_workflow_agent_workspace_files")
    @console_ns.doc(description="List a directory in a Workflow Agent node's sandbox workspace (read-only)")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "workflow_run_id": "Workflow run ID",
            "node_id": "Workflow Agent node ID",
            **query_params_from_model(WorkflowAgentWorkspaceListQuery),
        }
    )
    @console_ns.response(200, "Listing returned", console_ns.models[WorkspaceListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required("app", "app_create_and_management")
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, workflow_run_id: UUID, node_id: str):
        _, tenant_id = current_account_with_tenant()
        query = query_params_from_request(WorkflowAgentWorkspaceListQuery)
        try:
            result = WorkflowAgentWorkspaceService().list_files(
                tenant_id=tenant_id,
                app_id=app_model.id,
                workflow_run_id=str(workflow_run_id),
                node_id=node_id,
                node_execution_id=query.node_execution_id,
                path=query.path,
            )
        except Exception as exc:  # normalized to an HTTP response below
            return _handle(exc)
        return result.model_dump()


@console_ns.route(
    "/apps/<uuid:app_id>/workflow-runs/<uuid:workflow_run_id>/agent-nodes/<string:node_id>/workspace/files/preview"
)
class WorkflowAgentWorkspacePreviewResource(Resource):
    @console_ns.doc("preview_workflow_agent_workspace_file")
    @console_ns.doc(description="Preview a text/binary file in a Workflow Agent node's sandbox workspace")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "workflow_run_id": "Workflow run ID",
            "node_id": "Workflow Agent node ID",
            **query_params_from_model(WorkflowAgentWorkspaceFileQuery),
        }
    )
    @console_ns.response(200, "Preview returned", console_ns.models[WorkspacePreviewResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required("app", "app_create_and_management")
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, workflow_run_id: UUID, node_id: str):
        _, tenant_id = current_account_with_tenant()
        query = query_params_from_request(WorkflowAgentWorkspaceFileQuery)
        try:
            result = WorkflowAgentWorkspaceService().preview(
                tenant_id=tenant_id,
                app_id=app_model.id,
                workflow_run_id=str(workflow_run_id),
                node_id=node_id,
                node_execution_id=query.node_execution_id,
                path=query.path,
            )
        except Exception as exc:  # normalized to an HTTP response below
            return _handle(exc)
        return result.model_dump()


@console_ns.route(
    "/apps/<uuid:app_id>/workflow-runs/<uuid:workflow_run_id>/agent-nodes/<string:node_id>/workspace/files/download"
)
class WorkflowAgentWorkspaceDownloadResource(Resource):
    @console_ns.doc("download_workflow_agent_workspace_file")
    @console_ns.doc(description="Download a file from a Workflow Agent node's sandbox workspace (read-only)")
    @console_ns.doc(
        params={
            "app_id": "Application ID",
            "workflow_run_id": "Workflow run ID",
            "node_id": "Workflow Agent node ID",
            **query_params_from_model(WorkflowAgentWorkspaceFileQuery),
        }
    )
    @console_ns.doc(produces=["application/octet-stream"])
    @console_ns.response(200, "File bytes", _WorkspaceFileDownloadField)
    @console_ns.response(413, "File exceeds the workspace download limit")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required("app", "app_create_and_management")
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def get(self, app_model: App, workflow_run_id: UUID, node_id: str):
        _, tenant_id = current_account_with_tenant()
        query = query_params_from_request(WorkflowAgentWorkspaceFileQuery)
        try:
            result = WorkflowAgentWorkspaceService().download(
                tenant_id=tenant_id,
                app_id=app_model.id,
                workflow_run_id=str(workflow_run_id),
                node_id=node_id,
                node_execution_id=query.node_execution_id,
                path=query.path,
            )
        except Exception as exc:  # normalized to an HTTP response below
            return _handle(exc)
        return _download_response(result)
