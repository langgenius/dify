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
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    model_validate,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.login import login_required
from models import Account
from models.model import App, AppMode
from services.agent_app_sandbox_service import (
    AgentAppSandboxService,
    AgentSandboxInspectorError,
    WorkflowAgentSandboxService,
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
    if isinstance(exc, AgentSandboxInspectorError):
        return {"code": exc.code, "message": exc.message}, exc.status_code
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
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @with_current_tenant_id
    @with_current_user
    def get(self, current_user: Account, tenant_id: str, agent_id: UUID):
        service = AgentAppSandboxService()
        app_id = service.resolve_app_id(tenant_id=tenant_id, agent_id=str(agent_id))
        query = query_params_from_request(AgentSandboxInfoQuery)
        try:
            result = service.get_info(
                tenant_id=tenant_id,
                app_id=app_id,
                agent_id=str(agent_id),
                caller_type=query.caller_type,
                caller_id=query.caller_id,
                account_id=current_user.id,
            )
        except Exception as exc:
            return _handle(exc)
        return result.model_dump()


@console_ns.route("/agent/<uuid:agent_id>/sandbox/files")
class AgentAppSandboxListResource(Resource):
    @console_ns.doc("list_agent_app_sandbox_files")
    @console_ns.doc(description="List a directory in an Agent App conversation sandbox")
    @console_ns.doc(params={"agent_id": "Agent ID", **query_params_from_model(AgentSandboxListQuery)})
    @console_ns.response(200, "Listing returned", console_ns.models[SandboxListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @with_current_tenant_id
    @with_current_user
    def get(self, current_user: Account, tenant_id: str, agent_id: UUID):
        service = AgentAppSandboxService()
        app_id = service.resolve_app_id(tenant_id=tenant_id, agent_id=str(agent_id))
        query = query_params_from_request(AgentSandboxListQuery)
        try:
            result = service.list_files(
                tenant_id=tenant_id,
                app_id=app_id,
                agent_id=str(agent_id),
                caller_type=query.caller_type,
                caller_id=query.caller_id,
                account_id=current_user.id,
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
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @with_current_tenant_id
    @with_current_user
    def get(self, current_user: Account, tenant_id: str, agent_id: UUID):
        service = AgentAppSandboxService()
        app_id = service.resolve_app_id(tenant_id=tenant_id, agent_id=str(agent_id))
        query = query_params_from_request(AgentSandboxFileQuery)
        try:
            result = service.read_file(
                tenant_id=tenant_id,
                app_id=app_id,
                agent_id=str(agent_id),
                caller_type=query.caller_type,
                caller_id=query.caller_id,
                account_id=current_user.id,
                path=query.path,
            )
        except Exception as exc:
            return _handle(exc)
        return result.model_dump()


@console_ns.route("/agent/<uuid:agent_id>/sandbox/files/download")
class AgentAppSandboxDownloadResource(Resource):
    @console_ns.doc("download_agent_app_sandbox_file")
    @console_ns.doc(description="Create a ToolFile from one Agent App Binding file and return its download URL")
    @console_ns.expect(console_ns.models[AgentSandboxDownloadPayload.__name__])
    @console_ns.response(200, "Download URL returned", console_ns.models[SandboxDownloadResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @with_current_tenant_id
    @with_current_user
    @model_validate(AgentSandboxDownloadPayload)
    def post(
        self,
        req_data: AgentSandboxDownloadPayload,
        current_user: Account,
        tenant_id: str,
        agent_id: UUID,
    ):
        service = AgentAppSandboxService()
        app_id = service.resolve_app_id(tenant_id=tenant_id, agent_id=str(agent_id))
        try:
            result = service.download_file(
                tenant_id=tenant_id,
                app_id=app_id,
                agent_id=str(agent_id),
                caller_type=req_data.caller_type,
                caller_id=req_data.caller_id,
                account_id=current_user.id,
                path=req_data.path,
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
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
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
                session=db.session(),
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
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
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
                session=db.session(),
            )
        except Exception as exc:
            return _handle(exc)
        return result.model_dump()


@console_ns.route(
    "/apps/<uuid:app_id>/workflow-runs/<uuid:workflow_run_id>/agent-nodes/<string:node_id>/sandbox/files/download"
)
class WorkflowAgentSandboxDownloadResource(Resource):
    @console_ns.doc("download_workflow_agent_sandbox_file")
    @console_ns.doc(description="Create a ToolFile from one workflow Agent Binding file and return its download URL")
    @console_ns.expect(console_ns.models[WorkflowAgentSandboxDownloadPayload.__name__])
    @console_ns.response(200, "Download URL returned", console_ns.models[SandboxDownloadResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @with_current_user
    @with_current_tenant_id
    @model_validate(WorkflowAgentSandboxDownloadPayload)
    def post(
        self,
        req_data: WorkflowAgentSandboxDownloadPayload,
        tenant_id: str,
        current_user: Account,
        app_id: UUID,
        workflow_run_id: UUID,
        node_id: str,
    ):
        service = WorkflowAgentSandboxService()
        resolved_app_id = service.resolve_app_id(tenant_id=tenant_id, app_id=str(app_id))
        if resolved_app_id is None:
            raise AppNotFoundError()
        try:
            result = service.download_file(
                tenant_id=tenant_id,
                app_id=resolved_app_id,
                workflow_run_id=str(workflow_run_id),
                node_id=node_id,
                node_execution_id=req_data.node_execution_id,
                account_id=current_user.id,
                path=req_data.path,
            )
        except Exception as exc:
            return _handle(exc)
        return result.model_dump()
