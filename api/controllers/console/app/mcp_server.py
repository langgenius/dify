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
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import to_timestamp
from libs.login import current_account_with_tenant, login_required
from models.enums import AppMCPServerStatus
from models.model import AppMCPServer


class MCPServerCreatePayload(BaseModel):
    description: str | None = Field(default=None, description="Server description")
    parameters: dict[str, Any] = Field(..., description="Server parameters configuration")


class MCPServerUpdatePayload(BaseModel):
    id: str = Field(..., description="Server ID")
    description: str | None = Field(default=None, description="Server description")
    parameters: dict[str, Any] = Field(..., description="Server parameters configuration")
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
    @get_app_model
    def get(self, app_model):
        server = db.session.scalar(select(AppMCPServer).where(AppMCPServer.app_id == app_model.id).limit(1))
        if server is None:
            return {}
        return AppMCPServerResponse.model_validate(server, from_attributes=True).model_dump(mode="json")

    @console_ns.doc("create_app_mcp_server")
    @console_ns.doc(description="Create MCP server configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[MCPServerCreatePayload.__name__])
    @console_ns.response(
        201, "MCP server configuration created successfully", console_ns.models[AppMCPServerResponse.__name__]
    )
    @console_ns.response(403, "Insufficient permissions")
    @account_initialization_required
    @get_app_model
    @login_required
    @setup_required
    @edit_permission_required
    def post(self, app_model):
        _, current_tenant_id = current_account_with_tenant()
        payload = MCPServerCreatePayload.model_validate(console_ns.payload or {})

        description = payload.description
        if not description:
            description = app_model.description or ""

        server = AppMCPServer(
            name=app_model.name,
            description=description,
            parameters=json.dumps(payload.parameters, ensure_ascii=False),
            status=AppMCPServerStatus.ACTIVE,
            app_id=app_model.id,
            tenant_id=current_tenant_id,
            server_code=AppMCPServer.generate_server_code(16),
        )
        db.session.add(server)
        db.session.commit()
        return AppMCPServerResponse.model_validate(server, from_attributes=True).model_dump(mode="json"), 201

    @console_ns.doc("update_app_mcp_server")
    @console_ns.doc(description="Update MCP server configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[MCPServerUpdatePayload.__name__])
    @console_ns.response(
        200, "MCP server configuration updated successfully", console_ns.models[AppMCPServerResponse.__name__]
    )
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Server not found")
    @get_app_model
    @login_required
    @setup_required
    @account_initialization_required
    @edit_permission_required
    def put(self, app_model):
        payload = MCPServerUpdatePayload.model_validate(console_ns.payload or {})
        server = db.session.get(AppMCPServer, payload.id)
        if not server:
            raise NotFound()

        description = payload.description
        if description is None or not description:
            server.description = app_model.description or ""
        else:
            server.description = description

        server.name = app_model.name

        server.parameters = json.dumps(payload.parameters, ensure_ascii=False)
        if payload.status:
            try:
                server.status = AppMCPServerStatus(payload.status)
            except ValueError:
                raise ValueError("Invalid status")
        db.session.commit()
        return AppMCPServerResponse.model_validate(server, from_attributes=True).model_dump(mode="json")


@console_ns.route("/apps/<uuid:server_id>/server/refresh")
class AppMCPServerRefreshController(Resource):
    @console_ns.doc("refresh_app_mcp_server")
    @console_ns.doc(description="Refresh MCP server configuration and regenerate server code")
    @console_ns.doc(params={"server_id": "Server ID"})
    @console_ns.response(200, "MCP server refreshed successfully", console_ns.models[AppMCPServerResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Server not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, server_id):
        _, current_tenant_id = current_account_with_tenant()
        server = db.session.scalar(
            select(AppMCPServer)
            .where(AppMCPServer.id == server_id, AppMCPServer.tenant_id == current_tenant_id)
            .limit(1)
        )
        if not server:
            raise NotFound()
        server.server_code = AppMCPServer.generate_server_code(16)
        db.session.commit()
        return AppMCPServerResponse.model_validate(server, from_attributes=True).model_dump(mode="json")
