import json
from enum import StrEnum

from flask_restx import Resource, fields, marshal_with, reqparse
from werkzeug.exceptions import NotFound

from controllers.console import api, console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from extensions.ext_database import db
from fields.app_fields import app_server_fields
from libs.login import current_account_with_tenant, login_required
from models.model import AppMCPServer


class AppMCPServerStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


@console_ns.route("/apps/<uuid:app_id>/server")
class AppMCPServerController(Resource):
    @api.doc("get_app_mcp_server")
    @api.doc(description="Get MCP server configuration for an application")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "MCP server configuration retrieved successfully", app_server_fields)
    @login_required
    @account_initialization_required
    @setup_required
    @get_app_model
    @marshal_with(app_server_fields)
    def get(self, app_model):
        server = db.session.query(AppMCPServer).where(AppMCPServer.app_id == app_model.id).first()
        return server

    @api.doc("create_app_mcp_server")
    @api.doc(description="Create MCP server configuration for an application")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "MCPServerCreateRequest",
            {
                "description": fields.String(description="Server description"),
                "parameters": fields.Raw(required=True, description="Server parameters configuration"),
            },
        )
    )
    @api.response(201, "MCP server configuration created successfully", app_server_fields)
    @api.response(403, "Insufficient permissions")
    @account_initialization_required
    @get_app_model
    @login_required
    @setup_required
    @marshal_with(app_server_fields)
    @edit_permission_required
    def post(self, app_model):
        _, current_tenant_id = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument("description", type=str, required=False, location="json")
            .add_argument("parameters", type=dict, required=True, location="json")
        )
        args = parser.parse_args()

        description = args.get("description")
        if not description:
            description = app_model.description or ""

        server = AppMCPServer(
            name=app_model.name,
            description=description,
            parameters=json.dumps(args["parameters"], ensure_ascii=False),
            status=AppMCPServerStatus.ACTIVE,
            app_id=app_model.id,
            tenant_id=current_tenant_id,
            server_code=AppMCPServer.generate_server_code(16),
        )
        db.session.add(server)
        db.session.commit()
        return server

    @api.doc("update_app_mcp_server")
    @api.doc(description="Update MCP server configuration for an application")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "MCPServerUpdateRequest",
            {
                "id": fields.String(required=True, description="Server ID"),
                "description": fields.String(description="Server description"),
                "parameters": fields.Raw(required=True, description="Server parameters configuration"),
                "status": fields.String(description="Server status"),
            },
        )
    )
    @api.response(200, "MCP server configuration updated successfully", app_server_fields)
    @api.response(403, "Insufficient permissions")
    @api.response(404, "Server not found")
    @get_app_model
    @login_required
    @setup_required
    @account_initialization_required
    @marshal_with(app_server_fields)
    @edit_permission_required
    def put(self, app_model):
        parser = (
            reqparse.RequestParser()
            .add_argument("id", type=str, required=True, location="json")
            .add_argument("description", type=str, required=False, location="json")
            .add_argument("parameters", type=dict, required=True, location="json")
            .add_argument("status", type=str, required=False, location="json")
        )
        args = parser.parse_args()
        server = db.session.query(AppMCPServer).where(AppMCPServer.id == args["id"]).first()
        if not server:
            raise NotFound()

        description = args.get("description")
        if description is None:
            pass
        elif not description:
            server.description = app_model.description or ""
        else:
            server.description = description

        server.parameters = json.dumps(args["parameters"], ensure_ascii=False)
        if args["status"]:
            if args["status"] not in [status.value for status in AppMCPServerStatus]:
                raise ValueError("Invalid status")
            server.status = args["status"]
        db.session.commit()
        return server


@console_ns.route("/apps/<uuid:server_id>/server/refresh")
class AppMCPServerRefreshController(Resource):
    @api.doc("refresh_app_mcp_server")
    @api.doc(description="Refresh MCP server configuration and regenerate server code")
    @api.doc(params={"server_id": "Server ID"})
    @api.response(200, "MCP server refreshed successfully", app_server_fields)
    @api.response(403, "Insufficient permissions")
    @api.response(404, "Server not found")
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_server_fields)
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
        return server
