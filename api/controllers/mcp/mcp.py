from flask_restful import Resource, reqparse
from pydantic import ValidationError
from werkzeug.exceptions import NotFound

from controllers.mcp import api
from controllers.web.error import (
    AppUnavailableError,
)
from core.app.app_config.entities import VariableEntity
from core.mcp.server.handler import MCPServerReuqestHandler
from core.mcp.types import ClientRequest
from extensions.ext_database import db
from libs import helper
from models.model import App, AppMCPServer, AppMode


class MCPAppApi(Resource):
    def post(self, server_code):
        def int_or_str(value):
            if isinstance(value, int):
                return value
            elif isinstance(value, str):
                return int(value)
            else:
                raise ValueError("Invalid id")

        parser = reqparse.RequestParser()
        parser.add_argument("jsonrpc", type=str, required=True, location="json")
        parser.add_argument("method", type=str, required=True, location="json")
        parser.add_argument("params", type=dict, required=True, location="json")
        parser.add_argument("id", type=int_or_str, required=True, location="json")
        args = parser.parse_args()
        server = db.session.query(AppMCPServer).filter(AppMCPServer.server_code == server_code).first()
        if not server:
            raise NotFound("Server Not Found")
        app = db.session.query(App).filter(App.id == server.app_id).first()
        if not app:
            raise NotFound("App Not Found")
        if app.mode in {AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value}:
            workflow = app.workflow
            if workflow is None:
                raise AppUnavailableError()

            features_dict = workflow.features_dict
            user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config = app.app_model_config
            if app_model_config is None:
                raise AppUnavailableError()

            features_dict = app_model_config.to_dict()

            user_input_form = features_dict.get("user_input_form", [])
        try:
            user_input_form = [VariableEntity.model_validate(list(item.values())[0]) for item in user_input_form]
        except ValidationError as e:
            raise ValueError(f"Invalid user_input_form: {str(e)}")
        try:
            request = ClientRequest.model_validate(args)
        except ValidationError as e:
            raise ValueError(f"Invalid MCP request: {str(e)}")
        mcp_server_handler = MCPServerReuqestHandler(app, request, user_input_form)
        return helper.compact_generate_response(mcp_server_handler.handle())


api.add_resource(MCPAppApi, "/server/<string:server_code>/mcp")
