import json
from datetime import datetime
from typing import Any
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import Conflict, NotFound

from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, validate_request
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response, to_timestamp
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.app.mcp_server_service import (
    AppMCPServerAlreadyExistsError,
    AppMCPServerAppNotFoundError,
    AppMCPServerNotFoundError,
    AppMCPServerStatus,
)

_EDIT_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})


class MCPServerCreatePayload(BaseModel):
    description: str | None = Field(default=None, description="Server description")
    parameters: dict[str, Any] = Field(
        ...,
        description="Server parameters configuration",
    )


class MCPServerUpdatePayload(BaseModel):
    id: UUID = Field(..., description="Server ID")
    description: str | None = Field(default=None, description="Server description")
    parameters: dict[str, Any] = Field(
        ...,
        description="Server parameters configuration",
    )
    status: AppMCPServerStatus | None = Field(default=None, description="Server status")


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
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())])
    def get(self, request_context: RequestContext, app_id: UUID):
        try:
            server = application_services().app_mcp_servers.get(request_context, str(app_id))
        except AppMCPServerAppNotFoundError as error:
            raise AppNotFoundError() from error
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
    @console_ns.response(409, "MCP server already exists for this app")
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())])
    def post(self, request_context: RequestContext, app_id: UUID):
        payload = validate_request(MCPServerCreatePayload)
        try:
            server = application_services().app_mcp_servers.create(
                request_context, str(app_id), description=payload.description, parameters=payload.parameters
            )
        except AppMCPServerAppNotFoundError as error:
            raise AppNotFoundError() from error
        except AppMCPServerAlreadyExistsError as error:
            raise Conflict(str(error)) from error
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
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())])
    def put(self, request_context: RequestContext, app_id: UUID):
        payload = validate_request(MCPServerUpdatePayload)
        try:
            server = application_services().app_mcp_servers.update(
                request_context,
                str(app_id),
                server_id=str(payload.id),
                description=payload.description,
                parameters=payload.parameters,
                status=payload.status,
            )
        except AppMCPServerAppNotFoundError as error:
            raise AppNotFoundError() from error
        except AppMCPServerNotFoundError as error:
            raise NotFound from error
        return dump_response(AppMCPServerResponse, server)


@console_ns.route("/apps/<uuid:app_id>/server/refresh")
class AppMCPServerRefreshController(Resource):
    @console_ns.doc("refresh_app_mcp_server")
    @console_ns.doc(description="Refresh MCP server configuration and regenerate server code")
    @console_ns.doc(params={"app_id": "App ID"})
    @console_ns.response(200, "MCP server refreshed successfully", console_ns.models[AppMCPServerResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Server not found")
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())])
    def post(self, request_context: RequestContext, app_id: UUID):
        try:
            server = application_services().app_mcp_servers.refresh(request_context, str(app_id))
        except AppMCPServerAppNotFoundError as error:
            raise AppNotFoundError() from error
        except AppMCPServerNotFoundError as error:
            raise NotFound from error
        return dump_response(AppMCPServerResponse, server)
