import json
from collections.abc import Mapping
from typing import Any, cast

from configs import dify_config
from controllers.web.passport import generate_session_id
from core.app.app_config.entities import VariableEntity, VariableEntityType
from core.app.entities.app_invoke_entities import InvokeFrom
from core.mcp import types
from core.mcp.types import INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND
from core.model_runtime.utils.encoders import jsonable_encoder
from extensions.ext_database import db
from models.model import App, AppMCPServer, AppMode, EndUser
from services.app_generate_service import AppGenerateService

"""
Apply to MCP HTTP streamable server with stateless http
"""


class MCPServerRequestHandler:
    def __init__(
        self, app: App, request: types.ClientRequest | types.ClientNotification, user_input_form: list[VariableEntity]
    ):
        self.app = app
        self.request = request
        mcp_server = db.session.query(AppMCPServer).filter(AppMCPServer.app_id == self.app.id).first()
        if not mcp_server:
            raise ValueError("MCP server not found")
        self.mcp_server: AppMCPServer = mcp_server
        self.end_user = self.retrieve_end_user()
        self.user_input_form = user_input_form

    @property
    def request_type(self):
        return type(self.request.root)

    @property
    def parameter_schema(self):
        parameters, required = self._convert_input_form_to_parameters(self.user_input_form)
        if self.app.mode in {AppMode.COMPLETION.value, AppMode.WORKFLOW.value}:
            return {
                "type": "object",
                "properties": parameters,
                "required": required,
            }
        return {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "User Input/Question content"},
                **parameters,
            },
            "required": ["query", *required],
        }

    @property
    def capabilities(self):
        return types.ServerCapabilities(
            tools=types.ToolsCapability(listChanged=False),
        )

    def response(self, response: types.Result | str):
        if isinstance(response, str):
            sse_content = f"event: ping\ndata: {response}\n\n".encode()
            yield sse_content
            return
        json_response = types.JSONRPCResponse(
            jsonrpc="2.0",
            id=(self.request.root.model_extra or {}).get("id", 1),
            result=response.model_dump(by_alias=True, mode="json", exclude_none=True),
        )
        json_data = json.dumps(jsonable_encoder(json_response))

        sse_content = f"event: message\ndata: {json_data}\n\n".encode()

        yield sse_content

    def error_response(self, code: int, message: str, data=None):
        error_data = types.ErrorData(code=code, message=message, data=data)
        json_response = types.JSONRPCError(
            jsonrpc="2.0",
            id=(self.request.root.model_extra or {}).get("id", 1) or 1,
            error=error_data,
        )
        json_data = json.dumps(jsonable_encoder(json_response))

        sse_content = f"event: message\ndata: {json_data}\n\n".encode()

        yield sse_content

    def handle(self):
        handle_map = {
            types.InitializeRequest: self.initialize,
            types.ListToolsRequest: self.list_tools,
            types.CallToolRequest: self.invoke_tool,
            types.InitializedNotification: self.handle_notification,
        }
        try:
            if self.request_type in handle_map:
                return self.response(handle_map[self.request_type]())
            else:
                return self.error_response(METHOD_NOT_FOUND, f"Method not found: {self.request_type}")
        except ValueError as e:
            return self.error_response(INVALID_PARAMS, str(e))
        except Exception as e:
            return self.error_response(INTERNAL_ERROR, f"Internal server error: {str(e)}")

    def handle_notification(self):
        return "ping"

    def initialize(self):
        request = cast(types.InitializeRequest, self.request.root)
        client_info = request.params.clientInfo
        clinet_name = f"{client_info.name}@{client_info.version}"
        if not self.end_user:
            end_user = EndUser(
                tenant_id=self.app.tenant_id,
                app_id=self.app.id,
                type="mcp",
                name=clinet_name,
                session_id=generate_session_id(),
                external_user_id=self.mcp_server.id,
            )
            db.session.add(end_user)
            db.session.commit()
        return types.InitializeResult(
            protocolVersion=types.SERVER_LATEST_PROTOCOL_VERSION,
            capabilities=self.capabilities,
            serverInfo=types.Implementation(name="Dify", version=dify_config.CURRENT_VERSION),
            instructions=self.mcp_server.description,
        )

    def list_tools(self):
        if not self.end_user:
            raise ValueError("User not found")
        return types.ListToolsResult(
            tools=[
                types.Tool(
                    name=self.app.name,
                    description=self.mcp_server.description,
                    inputSchema=self.parameter_schema,
                )
            ],
        )

    def invoke_tool(self):
        if not self.end_user:
            raise ValueError("User not found")
        request = cast(types.CallToolRequest, self.request.root)
        args = request.params.arguments
        if not args:
            raise ValueError("No arguments provided")
        if self.app.mode in {AppMode.COMPLETION.value, AppMode.WORKFLOW.value}:
            args = {"inputs": args}
        else:
            args = {"query": args["query"], "inputs": {k: v for k, v in args.items() if k != "query"}}
        response = AppGenerateService.generate(self.app, self.end_user, args, InvokeFrom.MCP_SERVER, streaming=False)
        if isinstance(response, Mapping):
            answer = ""
            if self.app.mode in {
                AppMode.ADVANCED_CHAT.value,
                AppMode.COMPLETION.value,
                AppMode.CHAT.value,
                AppMode.AGENT_CHAT.value,
            }:
                answer = response["answer"]
            elif self.app.mode in {AppMode.WORKFLOW.value}:
                answer = json.dumps(response["data"]["outputs"], ensure_ascii=False)
            else:
                raise ValueError("Invalid app mode")
            # Not support image yet
            return types.CallToolResult(content=[types.TextContent(text=answer, type="text")])
        return None

    def retrieve_end_user(self):
        return (
            db.session.query(EndUser)
            .filter(EndUser.external_user_id == self.mcp_server.id, EndUser.type == "mcp")
            .first()
        )

    def _convert_input_form_to_parameters(self, user_input_form: list[VariableEntity]):
        parameters: dict[str, dict[str, Any]] = {}
        required = []
        for item in user_input_form:
            parameters[item.variable] = {}
            if item.type in (
                VariableEntityType.FILE,
                VariableEntityType.FILE_LIST,
                VariableEntityType.EXTERNAL_DATA_TOOL,
            ):
                continue
            if item.required:
                required.append(item.variable)
            description = self.mcp_server.parameters_dict[item.label]
            parameters[item.variable]["description"] = description
            if item.type in (VariableEntityType.TEXT_INPUT, VariableEntityType.PARAGRAPH):
                parameters[item.variable]["type"] = "string"
            elif item.type == VariableEntityType.SELECT:
                parameters[item.variable]["type"] = "string"
                parameters[item.variable]["enum"] = item.options
            elif item.type == VariableEntityType.NUMBER:
                parameters[item.variable]["type"] = "float"
        return parameters, required
