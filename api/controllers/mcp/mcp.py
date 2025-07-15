from flask_restful import Resource, reqparse
from pydantic import ValidationError

from controllers.console.app.mcp_server import AppMCPServerStatus
from controllers.mcp import api
from core.app.app_config.entities import VariableEntity
from core.mcp import types
from core.mcp.server.streamable_http import MCPServerStreamableHTTPRequestHandler
from core.mcp.types import ClientNotification, ClientRequest
from core.mcp.utils import create_mcp_error_response
from extensions.ext_database import db
from libs import helper
from models.model import App, AppMCPServer, AppMode


class MCPAppApi(Resource):
    def post(self, server_code):
        def int_or_str(value):
            if isinstance(value, (int, str)):
                return value
            else:
                return None

        parser = reqparse.RequestParser()
        parser.add_argument("jsonrpc", type=str, required=True, location="json")
        parser.add_argument("method", type=str, required=True, location="json")
        parser.add_argument("params", type=dict, required=False, location="json")
        parser.add_argument("id", type=int_or_str, required=False, location="json")
        args = parser.parse_args()

        request_id = args.get("id")

        server = db.session.query(AppMCPServer).filter(AppMCPServer.server_code == server_code).first()
        if not server:
            return helper.compact_generate_response(
                create_mcp_error_response(request_id, types.INVALID_REQUEST, "Server Not Found")
            )

        if server.status != AppMCPServerStatus.ACTIVE:
            return helper.compact_generate_response(
                create_mcp_error_response(request_id, types.INVALID_REQUEST, "Server is not active")
            )

        app = db.session.query(App).filter(App.id == server.app_id).first()
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


api.add_resource(MCPAppApi, "/server/<string:server_code>/mcp")
