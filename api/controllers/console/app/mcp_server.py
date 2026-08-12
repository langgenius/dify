import json
from datetime import datetime
from typing import Any

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from werkzeug.exceptions import NotFound

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    model_validate,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response, to_timestamp
from libs.login import login_required
from models.enums import AppMCPServerStatus
from models.model import App, AppMCPServer
from services.app_ref_service import AppRefService


class MCPServerCreatePayload(BaseModel):
    description: str | None = Field(default=None, description="Server description")
    parameters: dict[str, Any] = Field(
        ...,
        description="Server parameters configuration",
    )


class MCPServerUpdatePayload(BaseModel):
    id: str = Field(..., description="Server ID")
    description: str | None = Field(default=None, description="Server description")
    parameters: dict[str, Any] = Field(
        ...,
        description="Server parameters configuration",
    )
    status: str | None = Field(default=None, description="Server status")


class AppMCPServerResponse(ResponseModel):
    id: str
    name: str
    server_code: str
    description: str
    status: AppMCPServerStatus
    parameters: dict[str, Any] | list[Any] | str
    created_at: int | None = None
    updated_at: int | None = None

    @field_validator("parameters", mode="before")
    @classmethod
    def _normalize_parameters(cls, value: Any) -> Any:
        if isinstance(value, str):
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return value
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


register_schema_models(console_ns, MCPServerCreatePayload, MCPServerUpdatePayload, AppMCPServerResponse)


@console_ns.route("/apps/<uuid:app_id>/server")
class AppMCPServerController(Resource):
    @console_ns.doc("get_app_mcp_server")
    @console_ns.doc(description="Get MCP server configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200, "MCP server configuration retrieved successfully", console_ns.models[AppMCPServerResponse.__name__]
    )
    @login_required
    @account_initialization_required
    @setup_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @get_app_model
    def get(self, app_model: App):
        server = db.session.scalar(select(AppMCPServer).where(AppMCPServer.app_id == app_model.id).limit(1))
        if server is None:
            return {}
        return dump_response(AppMCPServerResponse, server)

    @console_ns.doc("create_app_mcp_server")
    @console_ns.doc(description="Create MCP server configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[MCPServerCreatePayload.__name__])
    @console_ns.response(
        201, "MCP server configuration created successfully", console_ns.models[AppMCPServerResponse.__name__]
    )
    @console_ns.response(403, "Insufficient permissions")
    @account_initialization_required
    @login_required
    @setup_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @with_current_tenant_id
    @get_app_model
    @model_validate(MCPServerCreatePayload)
    def post(self, req_data: MCPServerCreatePayload, current_tenant_id: str, app_model: App):
        description = req_data.description
        if not description:
            description = app_model.description or ""

        server = AppMCPServer(
            name=app_model.name,
            description=description,
            parameters=json.dumps(req_data.parameters, ensure_ascii=False),
            status=AppMCPServerStatus.ACTIVE,
            app_id=app_model.id,
            tenant_id=current_tenant_id,
            server_code=AppMCPServer.generate_server_code(16),
        )
        db.session.add(server)
        db.session.commit()
        return dump_response(AppMCPServerResponse, server), 201

    @console_ns.doc("update_app_mcp_server")
    @console_ns.doc(description="Update MCP server configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[MCPServerUpdatePayload.__name__])
    @console_ns.response(
        200, "MCP server configuration updated successfully", console_ns.models[AppMCPServerResponse.__name__]
    )
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Server not found")
    @login_required
    @setup_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @get_app_model
    @model_validate(MCPServerUpdatePayload)
    def put(self, req_data: MCPServerUpdatePayload, app_model: App):
        app_ref = AppRefService.create_app_ref(app_model)
        server_ref = AppRefService.create_mcp_server_ref(app_ref, req_data.id)
        server = db.session.scalar(
            select(AppMCPServer)
            .where(
                AppMCPServer.id == server_ref.server_id,
                AppMCPServer.tenant_id == server_ref.app.tenant_id,
                AppMCPServer.app_id == server_ref.app.app_id,
            )
            .limit(1)
        )
        if not server:
            raise NotFound()

        description = req_data.description
        if description is None or not description:
            server.description = app_model.description or ""
        else:
            server.description = description

        server.name = app_model.name

        server.parameters = json.dumps(req_data.parameters, ensure_ascii=False)
        if req_data.status:
            try:
                server.status = AppMCPServerStatus(req_data.status)
            except ValueError:
                raise ValueError("Invalid status")
        db.session.commit()
        return dump_response(AppMCPServerResponse, server)


@console_ns.route("/apps/<uuid:app_id>/server/refresh")
class AppMCPServerRefreshController(Resource):
    @console_ns.doc("refresh_app_mcp_server")
    @console_ns.doc(description="Refresh MCP server configuration and regenerate server code")
    @console_ns.doc(params={"app_id": "App ID"})
    @console_ns.response(200, "MCP server refreshed successfully", console_ns.models[AppMCPServerResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Server not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @with_current_tenant_id
    @get_app_model
    def post(self, current_tenant_id: str, app_model: App):
        server = db.session.scalar(
            select(AppMCPServer)
            .where(AppMCPServer.app_id == app_model.id, AppMCPServer.tenant_id == current_tenant_id)
            .limit(1)
        )
        if not server:
            raise NotFound()
        server.server_code = AppMCPServer.generate_server_code(16)
        db.session.commit()
        return dump_response(AppMCPServerResponse, server)
