"""
Workspace-level MCP controller.

Provides an HTTP JSON-RPC endpoint that exposes all MCP-enabled apps
in a workspace as individual MCP tools.

Endpoint: POST /mcp/workspace/<workspace_id>/mcp
Auth: Bearer <api-token> (Authorization header)
"""

from typing import Any

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.common.schema import register_schema_model
from controllers.mcp import workspace_mcp_ns
from core.mcp import types as mcp_types
from core.mcp.server.workspace_mcp_server import handle_workspace_mcp_request
from extensions.ext_database import db
from libs import helper
from models.model import ApiToken, EndUser, Tenant, TenantStatus


class MCPWorkspaceRequestError(Exception):
    """Custom exception for workspace MCP request processing errors."""

    def __init__(self, error_code: int, message: str):
        self.error_code = error_code
        self.message = message
        super().__init__(message)


class MCPWorkspaceRequestPayload(BaseModel):
    jsonrpc: str = Field(description="JSON-RPC version (should be '2.0')")
    method: str = Field(description="The method to invoke")
    params: dict[str, Any] | None = Field(default=None, description="Parameters for the method")
    id: int | str | None = Field(default=None, description="Request ID for tracking responses")


register_schema_model(workspace_mcp_ns, MCPWorkspaceRequestPayload)


def _validate_bearer_token() -> ApiToken:
    """Extract and validate Bearer token from Authorization header."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or " " not in auth_header:
        raise Unauthorized("Authorization header must be provided and start with 'Bearer'")

    auth_scheme, auth_token = auth_header.split(None, 1)
    if auth_scheme.lower() != "bearer":
        raise Unauthorized("Authorization scheme must be 'Bearer'")

    api_token = db.session.scalar(
        select(ApiToken).where(ApiToken.token == auth_token).limit(1)
    )
    if not api_token:
        raise Unauthorized("Invalid API token")

    return api_token


def _validate_workspace_access(api_token: ApiToken, workspace_id: str) -> Tenant:
    """Validate that the API token has access to the specified workspace."""
    if api_token.tenant_id and api_token.tenant_id == workspace_id:
        tenant = db.session.get(Tenant, workspace_id)
    else:
        raise Forbidden("API token does not have access to this workspace")

    if not tenant:
        raise NotFound("Workspace not found")
    if tenant.status == TenantStatus.ARCHIVE:
        raise Forbidden("The workspace's status is archived")

    return tenant


def _create_or_get_end_user(tenant_id: str, app_id: str) -> EndUser:
    """Create or retrieve an MCP end user for the given tenant/app."""
    end_user = db.session.scalar(
        select(EndUser)
        .where(EndUser.tenant_id == tenant_id)
        .where(EndUser.session_id == tenant_id)
        .where(EndUser.type == "mcp")
        .limit(1)
    )
    if not end_user:
        end_user = EndUser(
            tenant_id=tenant_id,
            app_id=app_id,
            type="mcp",
            name="mcp-workspace-client",
            session_id=tenant_id,
        )
        db.session.add(end_user)
        db.session.flush()
        db.session.refresh(end_user)
    return end_user


@workspace_mcp_ns.route("/workspace/<string:workspace_id>/mcp")
class MCPWorkspaceApi(Resource):
    @workspace_mcp_ns.expect(workspace_mcp_ns.models[MCPWorkspaceRequestPayload.__name__])
    @workspace_mcp_ns.doc("handle_workspace_mcp_request")
    @workspace_mcp_ns.doc(description="Handle MCP requests at the workspace level")
    @workspace_mcp_ns.doc(params={"workspace_id": "Workspace (tenant) ID"})
    @workspace_mcp_ns.doc(
        responses={
            200: "MCP response successfully processed",
            400: "Invalid MCP request or parameters",
            401: "Invalid or missing API token",
            403: "API token does not have workspace access",
            404: "Workspace not found",
        }
    )
    def post(self, workspace_id: str):
        """
        Handle MCP JSON-RPC requests at the workspace level.

        Exposes all MCP-enabled apps in a workspace as individual MCP tools,
        allowing MCP clients to discover and call multiple workflows from
        a single endpoint.

        Auth: Requires a valid Dify API token in the Authorization header
              as a Bearer token.
        """
        # 1. Validate auth
        api_token = _validate_bearer_token()

        # 2. Validate workspace access
        tenant = _validate_workspace_access(api_token, workspace_id)

        # 3. Parse the JSON-RPC payload
        try:
            payload = MCPWorkspaceRequestPayload.model_validate(workspace_mcp_ns.payload or {})
        except ValidationError:
            raise MCPWorkspaceRequestError(
                mcp_types.INVALID_REQUEST,
                "Invalid MCP request format",
            )

        request_id = payload.id
        args = payload.model_dump(exclude_none=True)

        # 4. Parse into MCP types
        try:
            mcp_request = mcp_types.ClientRequest.model_validate(args)
        except ValidationError:
            try:
                mcp_notification = mcp_types.ClientNotification.model_validate(args)
                if mcp_notification.root.method != "notifications/initialized":
                    raise MCPWorkspaceRequestError(
                        mcp_types.INVALID_REQUEST,
                        "Invalid notification method",
                    )
                return Response("", status=202, content_type="application/json")
            except ValidationError as e:
                raise MCPWorkspaceRequestError(
                    mcp_types.INVALID_PARAMS,
                    f"Invalid MCP request: {e}",
                )

        if request_id is None:
            raise MCPWorkspaceRequestError(
                mcp_types.INVALID_REQUEST,
                "Request ID is required",
            )

        # 5. Get or create end user for the workspace
        end_user = _create_or_get_end_user(tenant.id, tenant.id)

        # 6. Handle the MCP request
        result = handle_workspace_mcp_request(
            workspace_id=workspace_id,
            request=mcp_request,
            end_user=end_user,
            request_id=request_id,
        )

        if result is None:
            raise MCPWorkspaceRequestError(
                mcp_types.INTERNAL_ERROR,
                "No response generated for request",
            )

        return helper.compact_generate_response(
            result.model_dump(by_alias=True, mode="json", exclude_none=True)
        )
