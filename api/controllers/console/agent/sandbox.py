"""Console routes for Agent sandbox file operations.

This module exposes the renamed console ``/sandbox`` surface described by the
proposal. Workflow routes are enabled for workflow/advanced-chat apps and proxy
list/read/upload operations into the persisted workflow Agent sandbox. Agent App
routes use the parallel ``/agent-sandbox`` prefix but currently return the
explicit ``sandbox_unavailable`` service error by design because this worktree's
Agent App runtime does not yet execute through ``dify-agent`` shell sessions.

All operations are POST-shaped rather than GET download-style routes because the
request body now carries operation parameters such as relative path, read
encoding, and byte limits. Request parsing intentionally goes through the shared
``@model_validate(...)`` decorator so invalid payloads become console 422 client
errors instead of bubbling up as unhandled exceptions.
"""

from typing import ClassVar, Literal

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, model_validate, setup_required
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import current_account_with_tenant, login_required
from models.model import App, AppMode
from services.agent.sandbox_service import build_agent_app_sandbox_service, build_workflow_agent_sandbox_service


class SandboxListPayload(BaseModel):
    path: str = "."

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxReadPayload(BaseModel):
    path: str
    encoding: Literal["utf-8", "base64"] = "utf-8"
    max_bytes: int = Field(default=262144, ge=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxUploadPayload(BaseModel):
    path: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxFileEntryResponse(ResponseModel):
    name: str
    type: str
    size: int
    mtime: int


class SandboxListResponse(ResponseModel):
    path: str
    entries: list[SandboxFileEntryResponse] = Field(default_factory=list)
    truncated: bool


class SandboxReadResponse(ResponseModel):
    path: str
    encoding: str
    content: str
    size: int
    truncated: bool


class SandboxUploadedFileResponse(ResponseModel):
    id: str
    name: str
    size: int
    mime_type: str


class SandboxUploadResponse(ResponseModel):
    path: str
    file: SandboxUploadedFileResponse


register_schema_models(console_ns, SandboxListPayload, SandboxReadPayload, SandboxUploadPayload)
register_response_schema_models(
    console_ns,
    SandboxFileEntryResponse,
    SandboxListResponse,
    SandboxReadResponse,
    SandboxUploadedFileResponse,
    SandboxUploadResponse,
)


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<string:workflow_run_id>/agent-nodes/<string:node_id>/sandbox/files/list")
class WorkflowAgentSandboxListApi(Resource):
    """List files from one persisted workflow Agent sandbox."""

    @console_ns.expect(console_ns.models[SandboxListPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @model_validate(SandboxListPayload)
    def post(self, payload: SandboxListPayload, app_model: App, workflow_run_id: str, node_id: str):
        _, tenant_id = current_account_with_tenant()
        return dump_response(
            SandboxListResponse,
            build_workflow_agent_sandbox_service().list_files(
                tenant_id=tenant_id,
                app_id=app_model.id,
                workflow_run_id=workflow_run_id,
                node_id=node_id,
                path=payload.path,
            ),
        )


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<string:workflow_run_id>/agent-nodes/<string:node_id>/sandbox/files/read")
class WorkflowAgentSandboxReadApi(Resource):
    """Read one file from a persisted workflow Agent sandbox."""

    @console_ns.expect(console_ns.models[SandboxReadPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @model_validate(SandboxReadPayload)
    def post(self, payload: SandboxReadPayload, app_model: App, workflow_run_id: str, node_id: str):
        _, tenant_id = current_account_with_tenant()
        return dump_response(
            SandboxReadResponse,
            build_workflow_agent_sandbox_service().read_file(
                tenant_id=tenant_id,
                app_id=app_model.id,
                workflow_run_id=workflow_run_id,
                node_id=node_id,
                path=payload.path,
                encoding=payload.encoding,
                max_bytes=payload.max_bytes,
            ),
        )


@console_ns.route(
    "/apps/<uuid:app_id>/workflow-runs/<string:workflow_run_id>/agent-nodes/<string:node_id>/sandbox/files/upload"
)
class WorkflowAgentSandboxUploadApi(Resource):
    """Upload one workflow sandbox file through the backend stub flow."""

    @console_ns.expect(console_ns.models[SandboxUploadPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @model_validate(SandboxUploadPayload)
    def post(self, payload: SandboxUploadPayload, app_model: App, workflow_run_id: str, node_id: str):
        _, tenant_id = current_account_with_tenant()
        return dump_response(
            SandboxUploadResponse,
            build_workflow_agent_sandbox_service().upload_file(
                tenant_id=tenant_id,
                app_id=app_model.id,
                workflow_run_id=workflow_run_id,
                node_id=node_id,
                path=payload.path,
            ),
        )


@console_ns.route("/apps/<uuid:app_id>/agent-sandbox/files/list")
class AgentAppSandboxListApi(Resource):
    """Agent App sandbox list route.

    The route is intentionally present but currently surfaces the explicit
    ``sandbox_unavailable`` contract from the service layer until Agent App
    execution is backed by real ``dify-agent`` shell snapshots.
    """

    @console_ns.expect(console_ns.models[SandboxListPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT_CHAT])
    @model_validate(SandboxListPayload)
    def post(self, payload: SandboxListPayload, app_model: App):
        _, tenant_id = current_account_with_tenant()
        return dump_response(
            SandboxListResponse,
            build_agent_app_sandbox_service().list_files(tenant_id=tenant_id, app_id=app_model.id, path=payload.path),
        )


@console_ns.route("/apps/<uuid:app_id>/agent-sandbox/files/read")
class AgentAppSandboxReadApi(Resource):
    """Agent App sandbox read route with the current explicit unavailable contract."""

    @console_ns.expect(console_ns.models[SandboxReadPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT_CHAT])
    @model_validate(SandboxReadPayload)
    def post(self, payload: SandboxReadPayload, app_model: App):
        _, tenant_id = current_account_with_tenant()
        return dump_response(
            SandboxReadResponse,
            build_agent_app_sandbox_service().read_file(
                tenant_id=tenant_id,
                app_id=app_model.id,
                path=payload.path,
                encoding=payload.encoding,
                max_bytes=payload.max_bytes,
            ),
        )


@console_ns.route("/apps/<uuid:app_id>/agent-sandbox/files/upload")
class AgentAppSandboxUploadApi(Resource):
    """Agent App sandbox upload route with the current explicit unavailable contract."""

    @console_ns.expect(console_ns.models[SandboxUploadPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT_CHAT])
    @model_validate(SandboxUploadPayload)
    def post(self, payload: SandboxUploadPayload, app_model: App):
        _, tenant_id = current_account_with_tenant()
        return dump_response(
            SandboxUploadResponse,
            build_agent_app_sandbox_service().upload_file(tenant_id=tenant_id, app_id=app_model.id, path=payload.path),
        )
