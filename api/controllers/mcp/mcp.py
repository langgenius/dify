from typing import Optional, Union

from flask_restx import Resource, reqparse
from pydantic import ValidationError

from controllers.console.app.mcp_server import AppMCPServerStatus
from controllers.mcp import mcp_ns
from core.app.app_config.entities import VariableEntity
from core.mcp import types
from core.mcp.server.streamable_http import MCPServerStreamableHTTPRequestHandler
from core.mcp.types import ClientNotification, ClientRequest
from core.mcp.utils import create_mcp_error_response
from extensions.ext_database import db
from libs import helper
from models.model import App, AppMCPServer, AppMode


def int_or_str(value):
    """Validate that a value is either an integer or string."""
    if isinstance(value, (int, str)):
        return value
    else:
        return None


# Define parser for both documentation and validation
mcp_request_parser = reqparse.RequestParser()
mcp_request_parser.add_argument(
    "jsonrpc", type=str, required=True, location="json", help="JSON-RPC version (should be '2.0')"
)
mcp_request_parser.add_argument("method", type=str, required=True, location="json", help="The method to invoke")
mcp_request_parser.add_argument("params", type=dict, required=False, location="json", help="Parameters for the method")
mcp_request_parser.add_argument(
    "id", type=int_or_str, required=False, location="json", help="Request ID for tracking responses"
)


@mcp_ns.route("/server/<string:server_code>/mcp")
class MCPAppApi(Resource):
    @mcp_ns.expect(mcp_request_parser)
    @mcp_ns.doc("handle_mcp_request")
    @mcp_ns.doc(description="Handle Model Context Protocol (MCP) requests for a specific server")
    @mcp_ns.doc(params={"server_code": "Unique identifier for the MCP server"})
    @mcp_ns.doc(
        responses={
            200: "MCP response successfully processed",
            400: "Invalid MCP request or parameters",
            404: "Server or app not found",
        }
    )
    def post(self, server_code: str):
        """Handle MCP requests for a specific server.

        Processes JSON-RPC formatted requests according to the Model Context Protocol specification.
        Validates the server status and associated app before processing the request.

        Args:
            server_code: Unique identifier for the MCP server

        Returns:
            dict: JSON-RPC response from the MCP handler

        Raises:
            ValidationError: Invalid request format or parameters
        """
        # Parse and validate all arguments
        args = mcp_request_parser.parse_args()

        request_id: Optional[Union[int, str]] = args.get("id")

        server = db.session.query(AppMCPServer).where(AppMCPServer.server_code == server_code).first()
        if not server:
            return helper.compact_generate_response(
                create_mcp_error_response(request_id, types.INVALID_REQUEST, "Server Not Found")
            )

        if server.status != AppMCPServerStatus.ACTIVE:
            return helper.compact_generate_response(
                create_mcp_error_response(request_id, types.INVALID_REQUEST, "Server is not active")
            )

        app = db.session.query(App).where(App.id == server.app_id).first()
        if not app:
            return helper.compact_generate_response(
                create_mcp_error_response(request_id, types.INVALID_REQUEST, "App Not Found")
            )

        if app.mode in {AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value}:
            workflow = app.workflow
            if workflow is None:
                return helper.compact_generate_response(
                    create_mcp_error_response(request_id, types.INVALID_REQUEST, "App is unavailable")
                )

            user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config = app.app_model_config
            if app_model_config is None:
                return helper.compact_generate_response(
                    create_mcp_error_response(request_id, types.INVALID_REQUEST, "App is unavailable")
                )

            features_dict = app_model_config.to_dict()
            user_input_form = features_dict.get("user_input_form", [])
        converted_user_input_form: list[VariableEntity] = []
        try:
            for item in user_input_form:
                variable_type = item.get("type", "") or list(item.keys())[0]
                variable = item[variable_type]
                converted_user_input_form.append(
                    VariableEntity(
                        type=variable_type,
                        variable=variable.get("variable"),
                        description=variable.get("description") or "",
                        label=variable.get("label"),
                        required=variable.get("required", False),
                        max_length=variable.get("max_length"),
                        options=variable.get("options") or [],
                    )
                )
        except ValidationError as e:
            return helper.compact_generate_response(
                create_mcp_error_response(request_id, types.INVALID_PARAMS, f"Invalid user_input_form: {str(e)}")
            )

        try:
            request: ClientRequest | ClientNotification = ClientRequest.model_validate(args)
        except ValidationError as e:
            try:
                notification = ClientNotification.model_validate(args)
                request = notification
            except ValidationError as e:
                return helper.compact_generate_response(
                    create_mcp_error_response(request_id, types.INVALID_PARAMS, f"Invalid MCP request: {str(e)}")
                )

        mcp_server_handler = MCPServerStreamableHTTPRequestHandler(app, request, converted_user_input_form)
        response = mcp_server_handler.handle()
        return helper.compact_generate_response(response)
