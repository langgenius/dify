"""Console read-only inspector for the agent drive (ENG-624).

``agent-drive`` looks at the *static* drive assets (standardized skills and
committed files); the sibling ``agent-sandbox`` routes look at a *runtime*
sandbox workspace. Unlike the sandbox routes this never proxies to the agent
backend — drive data lives in the API's own DB/storage, served straight from
``AgentDriveService``. Download hands the browser an **external** signed URL
(the inner manifest hands agents internal ones — the two must never mix).
"""

from __future__ import annotations

from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
)
from controllers.console import console_ns
from controllers.console.agent.app_helpers import resolve_agent_app_model
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required, with_current_tenant_id
from fields.base import ResponseModel
from libs.login import login_required
from models.model import App, AppMode
from services.agent.composer_service import AgentComposerService
from services.agent_drive_service import AgentDriveError, AgentDriveService


class AgentDriveListQuery(BaseModel):
    prefix: str = Field(default="", description="Key prefix filter: '<slug>/' for one skill, 'files/' for files")
    node_id: str | None = Field(default=None, description="Workflow node ID (workflow composer variant)")


class AgentDriveListByAgentQuery(BaseModel):
    prefix: str = Field(default="", description="Key prefix filter: '<slug>/' for one skill, 'files/' for files")


class AgentDriveFileQuery(BaseModel):
    key: str = Field(min_length=1, description="Drive key, e.g. tender-analyzer/SKILL.md")
    node_id: str | None = Field(default=None, description="Workflow node ID (workflow composer variant)")


class AgentDriveFileByAgentQuery(BaseModel):
    key: str = Field(min_length=1, description="Drive key, e.g. tender-analyzer/SKILL.md")


class AgentDriveItemResponse(ResponseModel):
    key: str
    size: int | None = None
    mime_type: str | None = None
    hash: str | None = None
    file_kind: str
    created_at: int | None = None


class AgentDriveListResponse(ResponseModel):
    items: list[AgentDriveItemResponse] = Field(default_factory=list)


class AgentDrivePreviewResponse(ResponseModel):
    key: str
    size: int | None = None
    truncated: bool
    binary: bool
    text: str | None = None


class AgentDriveDownloadResponse(ResponseModel):
    url: str


register_response_schema_models(
    console_ns, AgentDriveListResponse, AgentDrivePreviewResponse, AgentDriveDownloadResponse
)


def _resolve_agent_id(app_model: App, node_id: str | None) -> str | None:
    """Agent identity for the drive: app-bound agent, or the workflow node binding."""
    if node_id:
        return AgentComposerService.resolve_workflow_node_agent_id(
            tenant_id=app_model.tenant_id, app_id=app_model.id, node_id=node_id
        )
    return app_model.bound_agent_id


def _agent_not_bound() -> tuple[dict[str, object], int]:
    return {"code": "agent_not_bound", "message": "no agent is bound for this app/node"}, 400


def _handle(exc: AgentDriveError) -> tuple[dict[str, object], int]:
    return {"code": exc.code, "message": exc.message}, exc.status_code


_WORKFLOW_APP_MODES = [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT]


@console_ns.route("/agent/<uuid:agent_id>/drive/files")
class AgentDriveListByAgentApi(Resource):
    @console_ns.doc("list_agent_drive_files_by_agent")
    @console_ns.doc(description="List agent drive entries for an Agent App")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentDriveListByAgentQuery)})
    @console_ns.response(200, "Drive entries", console_ns.models[AgentDriveListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID):
        query = query_params_from_request(AgentDriveListByAgentQuery)
        resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        try:
            items = AgentDriveService().manifest(tenant_id=tenant_id, agent_id=str(agent_id), prefix=query.prefix)
        except AgentDriveError as exc:
            return _handle(exc)
        return {"items": [{k: v for k, v in item.items() if k != "file_id"} for item in items]}


@console_ns.route("/agent/<uuid:agent_id>/drive/files/preview")
class AgentDrivePreviewByAgentApi(Resource):
    @console_ns.doc("preview_agent_drive_file_by_agent")
    @console_ns.doc(description="Truncated text preview of one Agent App drive value")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentDriveFileByAgentQuery)})
    @console_ns.response(200, "Preview", console_ns.models[AgentDrivePreviewResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID):
        query = query_params_from_request(AgentDriveFileByAgentQuery)
        resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        try:
            return AgentDriveService().preview(tenant_id=tenant_id, agent_id=str(agent_id), key=query.key)
        except AgentDriveError as exc:
            return _handle(exc)


@console_ns.route("/agent/<uuid:agent_id>/drive/files/download")
class AgentDriveDownloadByAgentApi(Resource):
    @console_ns.doc("download_agent_drive_file_by_agent")
    @console_ns.doc(description="Time-limited external signed URL for one Agent App drive value")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentDriveFileByAgentQuery)})
    @console_ns.response(200, "Signed URL", console_ns.models[AgentDriveDownloadResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID):
        query = query_params_from_request(AgentDriveFileByAgentQuery)
        resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id)
        try:
            url = AgentDriveService().download_url(tenant_id=tenant_id, agent_id=str(agent_id), key=query.key)
        except AgentDriveError as exc:
            return _handle(exc)
        return {"url": url}


@console_ns.route("/apps/<uuid:app_id>/agent/drive/files")
class AgentDriveListApi(Resource):
    @console_ns.doc("list_agent_drive_files")
    @console_ns.doc(description="List agent drive entries (read-only inspector; one endpoint for both tabs)")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentDriveListQuery)})
    @console_ns.response(200, "Drive entries", console_ns.models[AgentDriveListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    def get(self, app_model: App):
        query = query_params_from_request(AgentDriveListQuery)
        agent_id = _resolve_agent_id(app_model, query.node_id)
        if not agent_id:
            return _agent_not_bound()
        try:
            items = AgentDriveService().manifest(tenant_id=app_model.tenant_id, agent_id=agent_id, prefix=query.prefix)
        except AgentDriveError as exc:
            return _handle(exc)
        # the inner manifest exposes file_id for agent-side pulls; the console
        # inspector is a pure read surface and does not need value pointers
        return {"items": [{k: v for k, v in item.items() if k != "file_id"} for item in items]}


@console_ns.route("/apps/<uuid:app_id>/agent/drive/files/preview")
class AgentDrivePreviewApi(Resource):
    @console_ns.doc("preview_agent_drive_file")
    @console_ns.doc(description="Truncated text preview of one drive value (binary-safe; SKILL.md is the main case)")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentDriveFileQuery)})
    @console_ns.response(200, "Preview", console_ns.models[AgentDrivePreviewResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    def get(self, app_model: App):
        query = query_params_from_request(AgentDriveFileQuery)
        agent_id = _resolve_agent_id(app_model, query.node_id)
        if not agent_id:
            return _agent_not_bound()
        try:
            return AgentDriveService().preview(tenant_id=app_model.tenant_id, agent_id=agent_id, key=query.key)
        except AgentDriveError as exc:
            return _handle(exc)


@console_ns.route("/apps/<uuid:app_id>/agent/drive/files/download")
class AgentDriveDownloadApi(Resource):
    @console_ns.doc("download_agent_drive_file")
    @console_ns.doc(description="Time-limited external signed URL for one drive value (no streaming proxy)")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(AgentDriveFileQuery)})
    @console_ns.response(200, "Signed URL", console_ns.models[AgentDriveDownloadResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=_WORKFLOW_APP_MODES)
    def get(self, app_model: App):
        query = query_params_from_request(AgentDriveFileQuery)
        agent_id = _resolve_agent_id(app_model, query.node_id)
        if not agent_id:
            return _agent_not_bound()
        try:
            url = AgentDriveService().download_url(tenant_id=app_model.tenant_id, agent_id=agent_id, key=query.key)
        except AgentDriveError as exc:
            return _handle(exc)
        return {"url": url}


__all__ = [
    "AgentDriveDownloadApi",
    "AgentDriveDownloadByAgentApi",
    "AgentDriveListApi",
    "AgentDriveListByAgentApi",
    "AgentDrivePreviewApi",
    "AgentDrivePreviewByAgentApi",
]
