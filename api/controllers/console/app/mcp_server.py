import json
from enum import StrEnum

from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import NotFound

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from extensions.ext_database import db
from fields.app_fields import AppServer
from libs.login import current_account_with_tenant, login_required
from models.model import AppMCPServer

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"

console_ns.schema_model(AppServer.__name__, AppServer.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


def _dump_server(server: AppMCPServer | None):
    if server is None:
        return None
    return AppServer.model_validate(server, from_attributes=True).model_dump(mode="json")


class AppMCPServerStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class MCPServerCreatePayload(BaseModel):
    description: str | None = Field(default=None, description="Server description")
    parameters: dict = Field(..., description="Server parameters configuration")


class MCPServerUpdatePayload(BaseModel):
    id: str = Field(..., description="Server ID")
    description: str | None = Field(default=None, description="Server description")
    parameters: dict = Field(..., description="Server parameters configuration")
    status: str | None = Field(default=None, description="Server status")


for model in (MCPServerCreatePayload, MCPServerUpdatePayload):
    console_ns.schema_model(model.__name__, model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


@console_ns.route("/apps/<uuid:app_id>/server")
class AppMCPServerController(Resource):
    @console_ns.doc("get_app_mcp_server")
    @console_ns.doc(description="Get MCP server configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "MCP server configuration retrieved successfully", console_ns.models[AppServer.__name__])
    @login_required
    @account_initialization_required
    @setup_required
    @get_app_model(mode=None)
    def get(self, app_model):
        server = db.session.query(AppMCPServer).where(AppMCPServer.app_id == app_model.id).first()
        return _dump_server(server)

    @console_ns.doc("create_app_mcp_server")
    @console_ns.doc(description="Create MCP server configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[MCPServerCreatePayload.__name__])
    @console_ns.response(201, "MCP server configuration created successfully", console_ns.models[AppServer.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @account_initialization_required
    @get_app_model(mode=None)
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
        return _dump_server(server)

    @console_ns.doc("update_app_mcp_server")
    @console_ns.doc(description="Update MCP server configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[MCPServerUpdatePayload.__name__])
    @console_ns.response(200, "MCP server configuration updated successfully", console_ns.models[AppServer.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Server not found")
    @get_app_model
    @login_required
    @setup_required
    @account_initialization_required
    @edit_permission_required
    def put(self, app_model):
        payload = MCPServerUpdatePayload.model_validate(console_ns.payload or {})
        server = db.session.query(AppMCPServer).where(AppMCPServer.id == payload.id).first()
        if not server:
            raise NotFound()

        description = payload.description
        if description is None:
            pass
        elif not description:
            server.description = app_model.description or ""
        else:
            server.description = description

        server.parameters = json.dumps(payload.parameters, ensure_ascii=False)
        if payload.status:
            if payload.status not in [status.value for status in AppMCPServerStatus]:
                raise ValueError("Invalid status")
            server.status = payload.status
        db.session.commit()
        return _dump_server(server)


@console_ns.route("/apps/<uuid:server_id>/server/refresh")
class AppMCPServerRefreshController(Resource):
    @console_ns.doc("refresh_app_mcp_server")
    @console_ns.doc(description="Refresh MCP server configuration and regenerate server code")
    @console_ns.doc(params={"server_id": "Server ID"})
    @console_ns.response(200, "MCP server refreshed successfully", console_ns.models[AppServer.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Server not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, server_id):
        _, current_tenant_id = current_account_with_tenant()
        server = (
            db.session.query(AppMCPServer)
            .where(AppMCPServer.id == server_id)
            .where(AppMCPServer.tenant_id == current_tenant_id)
            .first()
        )
        if not server:
            raise NotFound()
        server.server_code = AppMCPServer.generate_server_code(16)
        db.session.commit()
        return _dump_server(server)
