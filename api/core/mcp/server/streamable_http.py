import json
import logging
from collections.abc import Mapping
from typing import Any, NotRequired, TypedDict, cast

from sqlalchemy.orm import Session

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting.rate_limit import RateLimitGenerator
from core.mcp import types as mcp_types
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from models.model import App, AppMCPServer, AppMode, EndUser
from services.app_generate_service import AppGenerateService

logger = logging.getLogger(__name__)

# Structured tool output (outputSchema + structuredContent) was introduced in MCP 2025-06-18.
STRUCTURED_OUTPUT_MIN_VERSION = "2025-06-18"


def _supports_structured_output(protocol_version: str) -> bool:
    """Return True when the negotiated protocol version supports structured tool output.

    MCP protocol versions are YYYY-MM-DD strings, so lexical comparison equals chronological.
    """
    return protocol_version >= STRUCTURED_OUTPUT_MIN_VERSION


def negotiate_protocol_version(header_value: str | None, is_initialize: bool) -> str | None:
    """Resolve the negotiated protocol version for an incoming MCP request.

    The version is taken from the MCP-Protocol-Version header on post-initialize requests.
    Returns the version to use for behavior gating, or None when the client sent an explicit
    but unsupported header (the caller should reply with a JSON-RPC INVALID_REQUEST error).
    Initialize requests negotiate via the request body, so they always receive
    DEFAULT_NEGOTIATED_VERSION and their header is never validated or rejected.
    """
    if is_initialize:
        return mcp_types.DEFAULT_NEGOTIATED_VERSION
    # Treat an absent or empty header as "not specified" -> default version.
    if not header_value:
        return mcp_types.DEFAULT_NEGOTIATED_VERSION
    if header_value not in mcp_types.SERVER_SUPPORTED_PROTOCOL_VERSIONS:
        return None
    return header_value


_EVENT_MESSAGE = "message"
_EVENT_AGENT_MESSAGE = "agent_message"
_EVENT_AGENT_THOUGHT = "agent_thought"


class ToolParameterSchemaDict(TypedDict):
    type: str
    properties: dict[str, Any]
    required: list[str]


class ToolArgumentsDict(TypedDict):
    query: NotRequired[str]
    inputs: dict[str, Any]


def handle_mcp_request(
    session: Session,
    app: App,
    request: mcp_types.ClientRequest,
    user_input_form: list[VariableEntity],
    mcp_server: AppMCPServer,
    end_user: EndUser | None = None,
    request_id: int | str = 1,
    protocol_version: str = mcp_types.DEFAULT_NEGOTIATED_VERSION,
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
        match request_root:
            case mcp_types.InitializeRequest():
                return create_success_response(
                    handle_initialize(mcp_server.description, request_root.params.protocolVersion)
                )
            case mcp_types.ListToolsRequest():
                return create_success_response(
                    handle_list_tools(
                        app.name,
                        app.mode,
                        user_input_form,
                        mcp_server.description,
                        mcp_server.parameters_dict,
                        protocol_version,
                    )
                )
            case mcp_types.CallToolRequest():
                return create_success_response(
                    handle_call_tool(session, app, request, user_input_form, end_user, protocol_version)
                )
            case mcp_types.PingRequest():
                return create_success_response(handle_ping())
            case _:
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


def handle_initialize(description: str, requested_version: str | int) -> mcp_types.InitializeResult:
    """Handle initialize request, negotiating the protocol version with the client.

    Echoes the client's requested version when the server supports it, otherwise returns the
    server's latest supported version (per the MCP lifecycle spec).
    """
    negotiated_version: str = mcp_types.SERVER_LATEST_PROTOCOL_VERSION
    if isinstance(requested_version, str) and requested_version in mcp_types.SERVER_SUPPORTED_PROTOCOL_VERSIONS:
        negotiated_version = requested_version

    capabilities = mcp_types.ServerCapabilities(
        tools=mcp_types.ToolsCapability(listChanged=False),
    )

    return mcp_types.InitializeResult(
        protocolVersion=negotiated_version,
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
    protocol_version: str = mcp_types.DEFAULT_NEGOTIATED_VERSION,
) -> mcp_types.ListToolsResult:
    """Handle list tools request"""
    parameter_schema = build_parameter_schema(app_mode, user_input_form, parameters_dict)
    supports_structured = _supports_structured_output(protocol_version)

    # For 2025-06-18+ clients, expose an explicit display title and a permissive output
    # schema. Both stay None (and are stripped by exclude_none serialization) for older
    # clients, so their tool definition is unchanged.
    tool = mcp_types.Tool(
        name=app_name,
        title=app_name if supports_structured else None,
        description=description,
        inputSchema=cast(dict[str, Any], parameter_schema),
        outputSchema={"type": "object"} if supports_structured else None,
    )
    return mcp_types.ListToolsResult(tools=[tool])


def handle_call_tool(
    session: Session,
    app: App,
    request: mcp_types.ClientRequest,
    user_input_form: list[VariableEntity],
    end_user: EndUser | None,
    protocol_version: str = mcp_types.DEFAULT_NEGOTIATED_VERSION,
) -> mcp_types.CallToolResult:
    """Handle call tool request"""
    request_obj = cast(mcp_types.CallToolRequest, request.root)
    args = prepare_tool_arguments(app, request_obj.params.arguments or {})

    if not end_user:
        raise ValueError("End user not found")

    response = AppGenerateService.generate(
        session,
        app,
        end_user,
        args,
        InvokeFrom.SERVICE_API,
        streaming=app.mode == AppMode.AGENT_CHAT,
    )

    answer = extract_answer_from_response(app, response)
    structured_content = None
    if _supports_structured_output(protocol_version):
        structured_content = extract_structured_output(app, response, answer)
    return mcp_types.CallToolResult(
        content=[mcp_types.TextContent(text=answer, type="text")],
        structuredContent=structured_content,
    )


def build_parameter_schema(
    app_mode: str,
    user_input_form: list[VariableEntity],
    parameters_dict: dict[str, str],
) -> ToolParameterSchemaDict:
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


def prepare_tool_arguments(app: App, arguments: dict[str, Any]) -> ToolArgumentsDict:
    """Prepare arguments based on app mode"""
    match app.mode:
        case AppMode.WORKFLOW:
            return {"inputs": arguments}
        case AppMode.COMPLETION:
            return {"query": "", "inputs": arguments}
        case _:
            # Chat modes - create a copy to avoid modifying original dict
            args_copy = arguments.copy()
            query = args_copy.pop("query", "")
            return {"query": query, "inputs": args_copy}


def extract_structured_output(app: App, response: Any, answer: str) -> dict[str, Any] | None:
    """Build MCP structured tool output (2025-06-18) from the app response.

    WORKFLOW mode exposes the raw outputs mapping; chat/agent/completion modes expose the
    answer string under an "answer" key. Returns None when no structured output is available.
    """
    match app.mode:
        case AppMode.WORKFLOW:
            if isinstance(response, Mapping):
                data = response.get("data")
                if isinstance(data, Mapping):
                    outputs = data.get("outputs")
                    # All three guards use Mapping for consistency; coerce to a concrete dict
                    # because structuredContent must be a JSON object (dict[str, Any]).
                    if isinstance(outputs, Mapping):
                        return dict(outputs)
            return None
        case AppMode.ADVANCED_CHAT | AppMode.CHAT | AppMode.AGENT_CHAT | AppMode.COMPLETION:
            return {"answer": answer}
        case _:
            return None


def extract_answer_from_response(app: App, response: Any) -> str:
    """Extract answer from app generate response"""
    answer = ""

    match response:
        case RateLimitGenerator():
            answer = process_streaming_response(response)
        case Mapping():
            answer = process_mapping_response(app, response)
        case _:
            logger.warning("Unexpected response type: %s", type(response))

    return answer


def process_streaming_response(response: RateLimitGenerator) -> str:
    """Process streaming response for agent chat mode"""
    answer = ""
    last_thought = ""
    for item in response.generator:
        if isinstance(item, str) and item.startswith("data: "):
            try:
                json_str = item[6:].strip()
                parsed_data = json.loads(json_str)
                event = parsed_data.get("event")
                if event in (_EVENT_MESSAGE, _EVENT_AGENT_MESSAGE):
                    answer += parsed_data.get("answer", "")
                elif event == _EVENT_AGENT_THOUGHT:
                    thought = parsed_data.get("thought", "")
                    if thought:
                        last_thought = thought
            except json.JSONDecodeError:
                continue
    return answer or last_thought


def process_mapping_response(app: App, response: Mapping) -> str:
    """Process mapping response based on app mode"""
    match app.mode:
        case AppMode.ADVANCED_CHAT | AppMode.COMPLETION | AppMode.CHAT | AppMode.AGENT_CHAT:
            return response.get("answer", "")
        case AppMode.WORKFLOW:
            return json.dumps(response["data"]["outputs"], ensure_ascii=False)
        case _:
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
        elif item.type == VariableEntityType.CHECKBOX:
            parameters[item.variable]["type"] = "boolean"
        elif item.type == VariableEntityType.JSON_OBJECT:
            parameters[item.variable]["type"] = "object"
            if item.json_schema:
                for key in ("properties", "required", "additionalProperties"):
                    if key in item.json_schema:
                        parameters[item.variable][key] = item.json_schema[key]
    return parameters, required
