"""Agent App sandbox file-system inspector (read-only).

Exposes the PRD "rc1-like sandbox file system, downloadable not editable" view
for an Agent App conversation: list a directory, preview a file, or download a
file from the conversation's shell-layer workspace. The API never touches
shellctl directly — it resolves the conversation's sandbox ``session_id`` from
the stored session snapshot and proxies to the agent backend's read-only
workspace endpoints.
"""

from typing import Literal

from flask import Response, request
from flask_restx import Resource
from pydantic import Field

from clients.agent_backend.errors import AgentBackendHTTPError, AgentBackendTransportError
from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from fields.base import ResponseModel
from libs.login import current_account_with_tenant, login_required
from models.model import App, AppMode
from services.agent_app_workspace_service import AgentAppWorkspaceService, AgentWorkspaceInspectorError


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


def _conversation_id() -> str:
    conversation_id = (request.args.get("conversation_id") or "").strip()
    if not conversation_id:
        raise AgentWorkspaceInspectorError("missing_conversation_id", "conversation_id is required", status_code=400)
    return conversation_id


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


@console_ns.route("/apps/<uuid:app_id>/agent-workspace/files")
class AgentAppWorkspaceListResource(Resource):
    @console_ns.doc("list_agent_app_workspace_files")
    @console_ns.doc(description="List a directory in an Agent App conversation's sandbox workspace (read-only)")
    @console_ns.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID", "path": "Directory path"})
    @console_ns.response(200, "Listing returned", console_ns.models[WorkspaceListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT])
    def get(self, app_model: App):
        _, tenant_id = current_account_with_tenant()
        try:
            result = AgentAppWorkspaceService().list_files(
                tenant_id=tenant_id,
                app_id=app_model.id,
                conversation_id=_conversation_id(),
                path=request.args.get("path", "."),
            )
        except Exception as exc:  # normalized to an HTTP response below
            return _handle(exc)
        return result.model_dump()


@console_ns.route("/apps/<uuid:app_id>/agent-workspace/files/preview")
class AgentAppWorkspacePreviewResource(Resource):
    @console_ns.doc("preview_agent_app_workspace_file")
    @console_ns.doc(description="Preview a text/binary file in an Agent App conversation's sandbox workspace")
    @console_ns.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID", "path": "File path"})
    @console_ns.response(200, "Preview returned", console_ns.models[WorkspacePreviewResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT])
    def get(self, app_model: App):
        _, tenant_id = current_account_with_tenant()
        path = request.args.get("path")
        if not path:
            return {"code": "missing_path", "message": "path is required"}, 400
        try:
            result = AgentAppWorkspaceService().preview(
                tenant_id=tenant_id,
                app_id=app_model.id,
                conversation_id=_conversation_id(),
                path=path,
            )
        except Exception as exc:  # normalized to an HTTP response below
            return _handle(exc)
        return result.model_dump()


@console_ns.route("/apps/<uuid:app_id>/agent-workspace/files/download")
class AgentAppWorkspaceDownloadResource(Resource):
    @console_ns.doc("download_agent_app_workspace_file")
    @console_ns.doc(description="Download a file from an Agent App conversation's sandbox workspace (read-only)")
    @console_ns.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID", "path": "File path"})
    @console_ns.response(200, "File bytes")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT])
    def get(self, app_model: App):
        _, tenant_id = current_account_with_tenant()
        path = request.args.get("path")
        if not path:
            return {"code": "missing_path", "message": "path is required"}, 400
        try:
            result = AgentAppWorkspaceService().download(
                tenant_id=tenant_id,
                app_id=app_model.id,
                conversation_id=_conversation_id(),
                path=path,
            )
        except Exception as exc:  # normalized to an HTTP response below
            return _handle(exc)
        filename = result.path.rsplit("/", 1)[-1] or "download"
        return Response(
            result.content,
            mimetype="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
