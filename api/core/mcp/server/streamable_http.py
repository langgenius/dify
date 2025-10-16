import json
import logging
from collections.abc import Mapping
from typing import Any, cast

from configs import dify_config
from core.app.app_config.entities import VariableEntity, VariableEntityType
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting.rate_limit import RateLimitGenerator
from core.mcp import types as mcp_types
from models.model import App, AppMCPServer, AppMode, EndUser
from services.app_generate_service import AppGenerateService

logger = logging.getLogger(__name__)


def handle_mcp_request(
    app: App,
    request: mcp_types.ClientRequest,
    user_input_form: list[VariableEntity],
    mcp_server: AppMCPServer,
    end_user: EndUser | None = None,
    request_id: int | str = 1,
) -> mcp_types.JSONRPCResponse | mcp_types.JSONRPCError:
    """
    Handle MCP request and return JSON-RPC response

    Args:
        app: The Dify app instance
        request: The JSON-RPC request message
        user_input_form: List of variable entities for the app
        mcp_server: The MCP server configuration
        end_user: Optional end user
        request_id: The request ID

    Returns:
        JSON-RPC response or error
    """

    request_type = type(request.root)
    request_root = request.root

    def create_success_response(result_data: mcp_types.Result) -> mcp_types.JSONRPCResponse:
        """Create success response with business result data"""
        return mcp_types.JSONRPCResponse(
            jsonrpc="2.0",
            id=request_id,
            result=result_data.model_dump(by_alias=True, mode="json", exclude_none=True),
        )

    def create_error_response(code: int, message: str) -> mcp_types.JSONRPCError:
        """Create error response with error code and message"""
        from core.mcp.types import ErrorData

        error_data = ErrorData(code=code, message=message)
        return mcp_types.JSONRPCError(
            jsonrpc="2.0",
            id=request_id,
            error=error_data,
        )

    try:
        # Dispatch request to appropriate handler based on instance type
        if isinstance(request_root, mcp_types.InitializeRequest):
            return create_success_response(handle_initialize(mcp_server.description))
        elif isinstance(request_root, mcp_types.ListToolsRequest):
            return create_success_response(
                handle_list_tools(
                    app.name, app.mode, user_input_form, mcp_server.description, mcp_server.parameters_dict
                )
            )
        elif isinstance(request_root, mcp_types.CallToolRequest):
            return create_success_response(handle_call_tool(app, request, user_input_form, end_user))
        elif isinstance(request_root, mcp_types.PingRequest):
            return create_success_response(handle_ping())
        else:
            return create_error_response(mcp_types.METHOD_NOT_FOUND, f"Method not found: {request_type.__name__}")

    except ValueError as e:
        logger.exception("Invalid params")
        return create_error_response(mcp_types.INVALID_PARAMS, str(e))
    except Exception as e:
        logger.exception("Internal server error")
        return create_error_response(mcp_types.INTERNAL_ERROR, "Internal server error: " + str(e))


def handle_ping() -> mcp_types.EmptyResult:
    """Handle ping request"""
    return mcp_types.EmptyResult()


def handle_initialize(description: str) -> mcp_types.InitializeResult:
    """Handle initialize request"""
    capabilities = mcp_types.ServerCapabilities(
        tools=mcp_types.ToolsCapability(listChanged=False),
    )

    return mcp_types.InitializeResult(
        protocolVersion=mcp_types.SERVER_LATEST_PROTOCOL_VERSION,
        capabilities=capabilities,
        serverInfo=mcp_types.Implementation(name="Dify", version=dify_config.project.version),
        instructions=description,
    )


def handle_list_tools(
    app_name: str,
    app_mode: str,
    user_input_form: list[VariableEntity],
    description: str,
    parameters_dict: dict[str, str],
) -> mcp_types.ListToolsResult:
    """Handle list tools request"""
    parameter_schema = build_parameter_schema(app_mode, user_input_form, parameters_dict)

    return mcp_types.ListToolsResult(
        tools=[
            mcp_types.Tool(
                name=app_name,
                description=description,
                inputSchema=parameter_schema,
            )
        ],
    )


def handle_call_tool(
    app: App,
    request: mcp_types.ClientRequest,
    user_input_form: list[VariableEntity],
    end_user: EndUser | None,
) -> mcp_types.CallToolResult:
    """Handle call tool request"""
    request_obj = cast(mcp_types.CallToolRequest, request.root)
    args = prepare_tool_arguments(app, request_obj.params.arguments or {})

    if not end_user:
        raise ValueError("End user not found")

    response = AppGenerateService.generate(
        app,
        end_user,
        args,
        InvokeFrom.SERVICE_API,
        streaming=app.mode == AppMode.AGENT_CHAT,
    )

    answer = extract_answer_from_response(app, response)
    return mcp_types.CallToolResult(content=[mcp_types.TextContent(text=answer, type="text")])


def build_parameter_schema(
    app_mode: str,
    user_input_form: list[VariableEntity],
    parameters_dict: dict[str, str],
) -> dict[str, Any]:
    """Build parameter schema for the tool"""
    parameters, required = convert_input_form_to_parameters(user_input_form, parameters_dict)

    if app_mode in {AppMode.COMPLETION, AppMode.WORKFLOW}:
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


def prepare_tool_arguments(app: App, arguments: dict[str, Any]) -> dict[str, Any]:
    """Prepare arguments based on app mode"""
    if app.mode == AppMode.WORKFLOW:
        return {"inputs": arguments}
    elif app.mode == AppMode.COMPLETION:
        return {"query": "", "inputs": arguments}
    else:
        # Chat modes - create a copy to avoid modifying original dict
        args_copy = arguments.copy()
        query = args_copy.pop("query", "")
        return {"query": query, "inputs": args_copy}


def extract_answer_from_response(app: App, response: Any) -> str:
    """Extract answer from app generate response"""
    answer = ""

    if isinstance(response, RateLimitGenerator):
        answer = process_streaming_response(response)
    elif isinstance(response, Mapping):
        answer = process_mapping_response(app, response)
    else:
        logger.warning("Unexpected response type: %s", type(response))

    return answer


def process_streaming_response(response: RateLimitGenerator) -> str:
    """Process streaming response for agent chat mode"""
    answer = ""
    for item in response.generator:
        if isinstance(item, str) and item.startswith("data: "):
            try:
                json_str = item[6:].strip()
                parsed_data = json.loads(json_str)
                if parsed_data.get("event") == "agent_thought":
                    answer += parsed_data.get("thought", "")
            except json.JSONDecodeError:
                continue
    return answer


def process_mapping_response(app: App, response: Mapping) -> str:
    """Process mapping response based on app mode"""
    if app.mode in {
        AppMode.ADVANCED_CHAT,
        AppMode.COMPLETION,
        AppMode.CHAT,
        AppMode.AGENT_CHAT,
    }:
        return response.get("answer", "")
    elif app.mode == AppMode.WORKFLOW:
        return json.dumps(response["data"]["outputs"], ensure_ascii=False)
    else:
        raise ValueError("Invalid app mode: " + str(app.mode))


def convert_input_form_to_parameters(
    user_input_form: list[VariableEntity],
    parameters_dict: dict[str, str],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """Convert user input form to parameter schema"""
    parameters: dict[str, dict[str, Any]] = {}
    required = []

    for item in user_input_form:
        if item.type in (
            VariableEntityType.FILE,
            VariableEntityType.FILE_LIST,
            VariableEntityType.EXTERNAL_DATA_TOOL,
        ):
            continue
        parameters[item.variable] = {}
        if item.required:
            required.append(item.variable)
        # if the workflow republished, the parameters not changed
        # we should not raise error here
        description = parameters_dict.get(item.variable, "")
        parameters[item.variable]["description"] = description
        if item.type in (VariableEntityType.TEXT_INPUT, VariableEntityType.PARAGRAPH):
            parameters[item.variable]["type"] = "string"
        elif item.type == VariableEntityType.SELECT:
            parameters[item.variable]["type"] = "string"
            parameters[item.variable]["enum"] = item.options
        elif item.type == VariableEntityType.NUMBER:
            parameters[item.variable]["type"] = "number"
    return parameters, required
