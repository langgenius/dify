from typing import Union

from flask import Response
from flask_restx import Resource, reqparse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from controllers.console.app.mcp_server import AppMCPServerStatus
from controllers.mcp import mcp_ns
from core.app.app_config.entities import VariableEntity
from core.mcp import types as mcp_types
from core.mcp.server.streamable_http import handle_mcp_request
from extensions.ext_database import db
from libs import helper
from models.model import App, AppMCPServer, AppMode, EndUser


class MCPRequestError(Exception):
    """Custom exception for MCP request processing errors"""

    def __init__(self, error_code: int, message: str):
        self.error_code = error_code
        self.message = message
        super().__init__(message)


def int_or_str(value):
    """Validate that a value is either an integer or string."""
    if isinstance(value, (int, str)):
        return value
    else:
        return None


# Define parser for both documentation and validation
mcp_request_parser = (
    reqparse.RequestParser()
    .add_argument("jsonrpc", type=str, required=True, location="json", help="JSON-RPC version (should be '2.0')")
    .add_argument("method", type=str, required=True, location="json", help="The method to invoke")
    .add_argument("params", type=dict, required=False, location="json", help="Parameters for the method")
    .add_argument("id", type=int_or_str, required=False, location="json", help="Request ID for tracking responses")
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
        args = mcp_request_parser.parse_args()
        request_id: Union[int, str] | None = args.get("id")
        mcp_request = self._parse_mcp_request(args)

        with Session(db.engine, expire_on_commit=False) as session:
            # Get MCP server and app
            mcp_server, app = self._get_mcp_server_and_app(server_code, session)
            self._validate_server_status(mcp_server)

            # Get user input form
            user_input_form = self._get_user_input_form(app)

            # Handle notification vs request differently
            return self._process_mcp_message(mcp_request, request_id, app, mcp_server, user_input_form, session)

    def _get_mcp_server_and_app(self, server_code: str, session: Session) -> tuple[AppMCPServer, App]:
        """Get and validate MCP server and app in one query session"""
        mcp_server = session.query(AppMCPServer).where(AppMCPServer.server_code == server_code).first()
        if not mcp_server:
            raise MCPRequestError(mcp_types.INVALID_REQUEST, "Server Not Found")

        app = session.query(App).where(App.id == mcp_server.app_id).first()
        if not app:
            raise MCPRequestError(mcp_types.INVALID_REQUEST, "App Not Found")

        return mcp_server, app

    def _validate_server_status(self, mcp_server: AppMCPServer):
        """Validate MCP server status"""
        if mcp_server.status != AppMCPServerStatus.ACTIVE:
            raise MCPRequestError(mcp_types.INVALID_REQUEST, "Server is not active")

    def _process_mcp_message(
        self,
        mcp_request: mcp_types.ClientRequest | mcp_types.ClientNotification,
        request_id: Union[int, str] | None,
        app: App,
        mcp_server: AppMCPServer,
        user_input_form: list[VariableEntity],
        session: Session,
    ) -> Response:
        """Process MCP message (notification or request)"""
        if isinstance(mcp_request, mcp_types.ClientNotification):
            return self._handle_notification(mcp_request)
        else:
            return self._handle_request(mcp_request, request_id, app, mcp_server, user_input_form, session)

    def _handle_notification(self, mcp_request: mcp_types.ClientNotification) -> Response:
        """Handle MCP notification"""
        # For notifications, only support init notification
        if mcp_request.root.method != "notifications/initialized":
            raise MCPRequestError(mcp_types.INVALID_REQUEST, "Invalid notification method")
        # Return HTTP 202 Accepted for notifications (no response body)
        return Response("", status=202, content_type="application/json")

    def _handle_request(
        self,
        mcp_request: mcp_types.ClientRequest,
        request_id: Union[int, str] | None,
        app: App,
        mcp_server: AppMCPServer,
        user_input_form: list[VariableEntity],
        session: Session,
    ) -> Response:
        """Handle MCP request"""
        if request_id is None:
            raise MCPRequestError(mcp_types.INVALID_REQUEST, "Request ID is required")

        result = self._handle_mcp_request(app, mcp_server, mcp_request, user_input_form, session, request_id)
        if result is None:
            # This shouldn't happen for requests, but handle gracefully
            raise MCPRequestError(mcp_types.INTERNAL_ERROR, "No response generated for request")

        return helper.compact_generate_response(result.model_dump(by_alias=True, mode="json", exclude_none=True))

    def _get_user_input_form(self, app: App) -> list[VariableEntity]:
        """Get and convert user input form"""
        # Get raw user input form based on app mode
        if app.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            if not app.workflow:
                raise MCPRequestError(mcp_types.INVALID_REQUEST, "App is unavailable")
            raw_user_input_form = app.workflow.user_input_form(to_old_structure=True)
        else:
            if not app.app_model_config:
                raise MCPRequestError(mcp_types.INVALID_REQUEST, "App is unavailable")
            features_dict = app.app_model_config.to_dict()
            raw_user_input_form = features_dict.get("user_input_form", [])

        # Convert to VariableEntity objects
        try:
            return self._convert_user_input_form(raw_user_input_form)
        except ValidationError as e:
            raise MCPRequestError(mcp_types.INVALID_PARAMS, f"Invalid user_input_form: {str(e)}")

    def _convert_user_input_form(self, raw_form: list[dict]) -> list[VariableEntity]:
        """Convert raw user input form to VariableEntity objects"""
        return [self._create_variable_entity(item) for item in raw_form]

    def _create_variable_entity(self, item: dict) -> VariableEntity:
        """Create a single VariableEntity from raw form item"""
        variable_type = item.get("type", "") or list(item.keys())[0]
        variable = item[variable_type]

        return VariableEntity(
            type=variable_type,
            variable=variable.get("variable"),
            description=variable.get("description") or "",
            label=variable.get("label"),
            required=variable.get("required", False),
            max_length=variable.get("max_length"),
            options=variable.get("options") or [],
        )

    def _parse_mcp_request(self, args: dict) -> mcp_types.ClientRequest | mcp_types.ClientNotification:
        """Parse and validate MCP request"""
        try:
            return mcp_types.ClientRequest.model_validate(args)
        except ValidationError:
            try:
                return mcp_types.ClientNotification.model_validate(args)
            except ValidationError as e:
                raise MCPRequestError(mcp_types.INVALID_PARAMS, f"Invalid MCP request: {str(e)}")

    def _retrieve_end_user(self, tenant_id: str, mcp_server_id: str) -> EndUser | None:
        """Get end user - manages its own database session"""
        with Session(db.engine, expire_on_commit=False) as session, session.begin():
            return (
                session.query(EndUser)
                .where(EndUser.tenant_id == tenant_id)
                .where(EndUser.session_id == mcp_server_id)
                .where(EndUser.type == "mcp")
                .first()
            )

    def _create_end_user(
        self, client_name: str, tenant_id: str, app_id: str, mcp_server_id: str, session: Session
    ) -> EndUser:
        """Create end user in existing session"""
        end_user = EndUser(
            tenant_id=tenant_id,
            app_id=app_id,
            type="mcp",
            name=client_name,
            session_id=mcp_server_id,
        )
        session.add(end_user)
        session.flush()  # Use flush instead of commit to keep transaction open
        session.refresh(end_user)
        return end_user

    def _handle_mcp_request(
        self,
        app: App,
        mcp_server: AppMCPServer,
        mcp_request: mcp_types.ClientRequest,
        user_input_form: list[VariableEntity],
        session: Session,
        request_id: Union[int, str],
    ) -> mcp_types.JSONRPCResponse | mcp_types.JSONRPCError | None:
        """Handle MCP request and return response"""
        end_user = self._retrieve_end_user(mcp_server.tenant_id, mcp_server.id)

        if not end_user and isinstance(mcp_request.root, mcp_types.InitializeRequest):
            client_info = mcp_request.root.params.clientInfo
            client_name = f"{client_info.name}@{client_info.version}"
            # Commit the session before creating end user to avoid transaction conflicts
            session.commit()
            with Session(db.engine, expire_on_commit=False) as create_session, create_session.begin():
                end_user = self._create_end_user(client_name, app.tenant_id, app.id, mcp_server.id, create_session)

        return handle_mcp_request(app, mcp_request, user_input_form, mcp_server, end_user, request_id)
