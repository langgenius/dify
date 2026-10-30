import json
import logging
from collections.abc import Mapping
from typing import Any, Literal, NotRequired, TypedDict, cast, get_args

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field, RootModel, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from controllers.common.access_response import mcp_server_not_found_response
from controllers.common.schema import register_response_schema_models, register_schema_model
from controllers.mcp import mcp_ns
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting.rate_limit import RateLimitGenerator
from core.db.session_factory import session_factory
from core.mcp import types as mcp_types
from fields.base import ResponseModel
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from libs import helper
from models.enums import EndUserType
from models.model import App, AppMCPServer, AppMode, EndUser
from services.app.mcp_server_service import AppMCPServerStatus
from services.errors.app import TriggerWorkflowServiceModeUnavailableError

_MCP_METHODS = frozenset(
    method
    for message_type in (mcp_types.ClientRequest, mcp_types.ClientNotification)
    for model in get_args(message_type.model_fields["root"].annotation)
    for method in get_args(model.model_fields["method"].annotation)
)


class MCPRequestError(Exception):
    """Custom exception for MCP request processing errors"""

    def __init__(self, error_code: int, message: str):
        self.error_code = error_code
        self.message = message
        super().__init__(message)


class MCPServerNotFoundError(MCPRequestError):
    """An unavailable server, backing app, or inactive server is one opaque identity failure."""

    def __init__(self):
        super().__init__(mcp_types.INVALID_REQUEST, "Server Not Found")


class MCPRequestPayload(BaseModel):
    jsonrpc: str = Field(description="JSON-RPC version (should be '2.0')")
    method: str = Field(description="The method to invoke")
    params: dict[str, Any] | None = Field(default=None, description="Parameters for the method")
    id: int | str | None = Field(default=None, description="Request ID for tracking responses")


class MCPJSONRPCErrorResponse(ResponseModel):
    jsonrpc: Literal["2.0"]
    id: int | float | str | None
    error: mcp_types.ErrorData


class MCPJSONRPCResponse(RootModel[mcp_types.JSONRPCResponse | MCPJSONRPCErrorResponse]):
    pass


register_schema_model(mcp_ns, MCPRequestPayload)
register_response_schema_models(mcp_ns, MCPJSONRPCResponse)


@mcp_ns.route("/server/<string:server_code>/mcp")
class MCPAppApi(Resource):
    @mcp_ns.expect(mcp_ns.models[MCPRequestPayload.__name__], validate=False)
    @mcp_ns.doc("handle_mcp_request")
    @mcp_ns.doc(description="Handle Model Context Protocol (MCP) requests for a specific server")
    @mcp_ns.doc(params={"server_code": "Unique identifier for the MCP server"})
    @mcp_ns.response(200, "MCP JSON-RPC response", mcp_ns.models[MCPJSONRPCResponse.__name__])
    @mcp_ns.response(202, "MCP notification accepted")
    @mcp_ns.response(400, "Invalid MCP request or parameters", mcp_ns.models[MCPJSONRPCErrorResponse.__name__])
    @mcp_ns.response(404, "Server or app not found", mcp_ns.models[MCPJSONRPCErrorResponse.__name__])
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
        # response-contract:ignore MCP route returns Flask Response from JSON-RPC handler
        sessions = session_factory.get_session_maker()
        try:
            # Resolve identity before parsing the body: missing identities have
            # one bounded response even for malformed or oversized JSON. Only
            # scalar IDs cross this short read session, never its ORM objects.
            with sessions.begin() as session:
                mcp_server, app = self._get_mcp_server_and_app(server_code, session)
                self._validate_server_status(mcp_server)
                identity = (mcp_server.id, app.id, app.tenant_id)
        except MCPServerNotFoundError:
            # Error formatting may read the request body; release DB resources first.
            return mcp_server_not_found_response()

        # Allowed requests retain the existing full body/protocol parser. The
        # 64 KiB cap belongs only to opaque errors, not normal MCP invocations.
        args = MCPRequestPayload.model_validate(mcp_ns.payload or {})
        request_id: int | str | None = args.id
        try:
            mcp_request = self._parse_mcp_request(args.model_dump(exclude_none=True))
        except MCPRequestError as e:
            if "id" not in args.model_fields_set:
                return Response("", status=202)
            response = helper.compact_generate_response(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": e.error_code, "message": e.message},
                }
            )
            # A legacy HTTP error lets modern clients fall back to initialize.
            response.status_code = 400
            return response

        is_initialize = isinstance(mcp_request.root, mcp_types.InitializeRequest)
        header_value = request.headers.get("MCP-Protocol-Version")
        protocol_version = negotiate_protocol_version(header_value, is_initialize)
        if protocol_version is None:
            if isinstance(mcp_request, mcp_types.ClientNotification):
                protocol_version = mcp_types.DEFAULT_NEGOTIATED_VERSION
            else:
                return self._protocol_version_error_response(request_id, header_value)

        try:
            # Reading/parsing may have taken time. Revalidate in the original
            # execution transaction and use fresh, attached ORM records. A code
            # reassigned to a different server/App/tenant is not this request's identity.
            with sessions.begin() as session:
                mcp_server, app = self._get_mcp_server_and_app(server_code, session)
                self._validate_server_status(mcp_server)
                if (mcp_server.id, app.id, app.tenant_id) != identity:
                    raise MCPServerNotFoundError()
                user_input_form = self._get_user_input_form(app, session=session)

                return self._process_mcp_message(
                    mcp_request, request_id, app, mcp_server, user_input_form, session, protocol_version
                )
        except MCPServerNotFoundError:
            return mcp_server_not_found_response()

    def _protocol_version_error_response(self, request_id: int | str | None, header_value: str | None) -> Response:
        """Return a JSON-RPC error for an unsupported MCP-Protocol-Version header.

        Per JSON-RPC 2.0, an error whose request id is unknown uses a null id, so we echo the
        offending request's id directly (None -> null) instead of fabricating a placeholder.
        """
        error_data = mcp_types.ErrorData(
            code=mcp_types.INVALID_REQUEST,
            message=f"Unsupported MCP-Protocol-Version: {header_value}",
        )
        error_response = {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": error_data.model_dump(by_alias=True, mode="json", exclude_none=True),
        }
        return helper.compact_generate_response(error_response)

    def _get_mcp_server_and_app(self, server_code: str, session: Session) -> tuple[AppMCPServer, App]:
        """Get and validate MCP server and app in one query session"""
        mcp_server = session.scalar(select(AppMCPServer).where(AppMCPServer.server_code == server_code).limit(1))
        if not mcp_server:
            raise MCPServerNotFoundError()

        app = session.scalar(
            select(App).where(App.id == mcp_server.app_id, App.tenant_id == mcp_server.tenant_id).limit(1)
        )
        if not app:
            raise MCPServerNotFoundError()

        return mcp_server, app

    def _validate_server_status(self, mcp_server: AppMCPServer):
        """Validate MCP server status"""
        if mcp_server.status != AppMCPServerStatus.ACTIVE:
            raise MCPServerNotFoundError()

    def _process_mcp_message(
        self,
        mcp_request: mcp_types.ClientRequest | mcp_types.ClientNotification,
        request_id: int | str | None,
        app: App,
        mcp_server: AppMCPServer,
        user_input_form: list[VariableEntity],
        session: Session,
        protocol_version: str,
    ) -> Response:
        """Process MCP message (notification or request)"""
        if isinstance(mcp_request, mcp_types.ClientNotification):
            return self._handle_notification(mcp_request)
        else:
            return self._handle_request(
                mcp_request, request_id, app, mcp_server, user_input_form, session, protocol_version
            )

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
        request_id: int | str | None,
        app: App,
        mcp_server: AppMCPServer,
        user_input_form: list[VariableEntity],
        session: Session,
        protocol_version: str,
    ) -> Response:
        """Handle MCP request"""
        if request_id is None:
            raise MCPRequestError(mcp_types.INVALID_REQUEST, "Request ID is required")

        result = self._handle_mcp_request(
            app, mcp_server, mcp_request, user_input_form, session, request_id, protocol_version
        )
        if result is None:
            # This shouldn't happen for requests, but handle gracefully
            raise MCPRequestError(mcp_types.INTERNAL_ERROR, "No response generated for request")

        return helper.compact_generate_response(result.model_dump(by_alias=True, mode="json", exclude_none=True))

    def _get_user_input_form(self, app: App, *, session: Session) -> list[VariableEntity]:
        """Get and convert user input form"""
        # Get raw user input form based on app mode
        if app.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = app.workflow_with_session(session=session)
            if workflow is None:
                raise MCPRequestError(mcp_types.INVALID_REQUEST, "App is unavailable")
            raw_user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config = app.app_model_config_with_session(session=session)
            if app_model_config is None:
                raise MCPRequestError(mcp_types.INVALID_REQUEST, "App is unavailable")
            raw_user_input_form = app_model_config.user_input_form_list

        # Convert to VariableEntity objects
        try:
            return self._convert_user_input_form(raw_user_input_form)
        except ValidationError as e:
            raise MCPRequestError(mcp_types.INVALID_PARAMS, f"Invalid user_input_form: {str(e)}") from e

    def _convert_user_input_form(self, raw_form: list[dict[str, Any]]) -> list[VariableEntity]:
        """Convert raw user input form to VariableEntity objects"""
        return [self._create_variable_entity(item) for item in raw_form]

    def _create_variable_entity(self, item: dict[str, Any]) -> VariableEntity:
        """Create a single VariableEntity from raw form item"""
        variable_type_raw: str = item.get("type", "") or list(item.keys())[0]
        try:
            variable_type = VariableEntityType(variable_type_raw)
        except ValueError as e:
            raise MCPRequestError(
                mcp_types.INVALID_PARAMS, f"Invalid user_input_form variable type: {variable_type_raw}"
            ) from e
        variable = item[variable_type_raw]

        return VariableEntity(
            type=variable_type,
            variable=variable.get("variable"),
            description=variable.get("description") or "",
            label=variable.get("label"),
            required=variable.get("required", False),
            max_length=variable.get("max_length"),
            options=variable.get("options") or [],
            json_schema=variable.get("json_schema"),
        )

    def _parse_mcp_request(self, args: dict[str, Any]) -> mcp_types.ClientRequest | mcp_types.ClientNotification:
        """Parse and validate MCP request"""
        if args.get("method") not in _MCP_METHODS:
            raise MCPRequestError(mcp_types.METHOD_NOT_FOUND, "Method not found")
        try:
            return mcp_types.ClientRequest.model_validate(args)
        except ValidationError:
            try:
                return mcp_types.ClientNotification.model_validate(args)
            except ValidationError as e:
                raise MCPRequestError(mcp_types.INVALID_PARAMS, "Invalid MCP request parameters") from e

    def _retrieve_end_user(self, tenant_id: str, mcp_server_id: str, session: Session) -> EndUser | None:
        """Get end user in the caller session"""
        return session.scalar(
            select(EndUser)
            .where(EndUser.tenant_id == tenant_id)
            .where(EndUser.session_id == mcp_server_id)
            .where(EndUser.type == EndUserType.MCP)
            .limit(1)
        )

    def _create_end_user(
        self, client_name: str, tenant_id: str, app_id: str, mcp_server_id: str, session: Session
    ) -> EndUser:
        """Create end user in existing session"""
        end_user = EndUser(
            tenant_id=tenant_id,
            app_id=app_id,
            type=EndUserType.MCP,
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
        request_id: int | str,
        protocol_version: str,
    ) -> mcp_types.JSONRPCResponse | mcp_types.JSONRPCError | None:
        """Handle MCP request and return response"""
        end_user = self._retrieve_end_user(mcp_server.tenant_id, mcp_server.id, session)

        if not end_user and isinstance(mcp_request.root, mcp_types.InitializeRequest):
            client_info = mcp_request.root.params.clientInfo
            client_name = f"{client_info.name}@{client_info.version}"
            end_user = self._create_end_user(client_name, app.tenant_id, app.id, mcp_server.id, session)

        return handle_mcp_request(
            session, app, mcp_request, user_input_form, mcp_server, end_user, request_id, protocol_version
        )


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

    def create_error_response(
        code: int,
        message: str,
        *,
        data: Mapping[str, Any] | None = None,
    ) -> mcp_types.JSONRPCError:
        """Create error response with error code and message"""
        from core.mcp.types import ErrorData

        error_data = ErrorData(code=code, message=message, data=data)
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

    except TriggerWorkflowServiceModeUnavailableError as e:
        return create_error_response(
            mcp_types.INVALID_REQUEST,
            str(e),
            data={"code": e.error_code},
        )
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

    from extensions.ext_application_services import application_services

    response = application_services().app_generation.generate(
        session=session,
        app_model=app,
        user=end_user,
        args=args,
        invoke_from=InvokeFrom.SERVICE_API,
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
    for item in response.generator:
        if isinstance(item, str) and item.startswith("data: "):
            try:
                json_str = item[6:].strip()
                parsed_data = json.loads(json_str)
                if parsed_data.get("event") == "agent_message":
                    answer += parsed_data.get("answer", "")
            except json.JSONDecodeError:
                continue
    return answer


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
