"""
Workspace-level MCP server that exposes multiple Dify workflows/tools
as individual MCP tools from a single endpoint.

This handler supports:
- tools/list: Returns all published apps/workflows in the workspace as MCP tools
- tools/call: Routes execution to the specific app identified by tool name
- initialize: Returns workspace-level server capabilities
- ping: Health check
"""

import json
import logging
from collections.abc import Mapping
from typing import Any, cast

from sqlalchemy import select

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting.rate_limit import RateLimitGenerator
from core.mcp import types as mcp_types
from extensions.ext_database import db
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from models.enums import AppMCPServerStatus, AppMode
from models.model import App, AppMCPServer, EndUser
from services.app_generate_service import AppGenerateService

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def handle_workspace_mcp_request(
    workspace_id: str,
    request: mcp_types.ClientRequest,
    end_user: EndUser | None = None,
    request_id: int | str = 1,
) -> mcp_types.JSONRPCResponse | mcp_types.JSONRPCError:
    """
    Handle an MCP JSON-RPC request at the workspace level.

    Args:
        workspace_id: The tenant/workspace ID.
        request: The parsed JSON-RPC ClientRequest.
        end_user: Optional end user for tool calls.
        request_id: The JSON-RPC request ID.

    Returns:
        A JSONRPCResponse or JSONRPCError.
    """

    request_root = request.root

    def _ok(result_data: mcp_types.Result) -> mcp_types.JSONRPCResponse:
        return mcp_types.JSONRPCResponse(
            jsonrpc="2.0",
            id=request_id,
            result=result_data.model_dump(by_alias=True, mode="json", exclude_none=True),
        )

    def _err(code: int, message: str) -> mcp_types.JSONRPCError:
        from core.mcp.types import ErrorData

        return mcp_types.JSONRPCError(
            jsonrpc="2.0",
            id=request_id,
            error=ErrorData(code=code, message=message),
        )

    try:
        match request_root:
            case mcp_types.InitializeRequest():
                return _ok(_handle_initialize())
            case mcp_types.ListToolsRequest():
                return _ok(_handle_list_tools(workspace_id))
            case mcp_types.CallToolRequest():
                return _ok(_handle_call_tool(workspace_id, request, end_user))
            case mcp_types.PingRequest():
                return _ok(mcp_types.EmptyResult())
            case _:
                return _err(
                    mcp_types.METHOD_NOT_FOUND,
                    f"Method not found: {type(request_root).__name__}",
                )
    except ValueError as e:
        logger.exception("Invalid params in workspace MCP handler")
        return _err(mcp_types.INVALID_PARAMS, str(e))
    except Exception as e:
        logger.exception("Internal error in workspace MCP handler")
        return _err(mcp_types.INTERNAL_ERROR, f"Internal server error: {e}")


# ---------------------------------------------------------------------------
# Initialize
# ---------------------------------------------------------------------------


def _handle_initialize() -> mcp_types.InitializeResult:
    capabilities = mcp_types.ServerCapabilities(
        tools=mcp_types.ToolsCapability(listChanged=False),
    )
    return mcp_types.InitializeResult(
        protocolVersion=mcp_types.SERVER_LATEST_PROTOCOL_VERSION,
        capabilities=capabilities,
        serverInfo=mcp_types.Implementation(name="Dify Workspace", version=dify_config.project.version),
        instructions="Workspace-level MCP server for Dify. Use tools/list to discover available workflows.",
    )


# ---------------------------------------------------------------------------
# tools/list — enumerate every active MCP-enabled app in the workspace
# ---------------------------------------------------------------------------


def _handle_list_tools(workspace_id: str) -> mcp_types.ListToolsResult:
    """Return every active MCP server in the workspace as an individual tool."""
    servers = (
        db.session.execute(
            select(AppMCPServer, App)
            .join(App, App.id == AppMCPServer.app_id)
            .where(
                AppMCPServer.tenant_id == workspace_id,
                AppMCPServer.status == AppMCPServerStatus.ACTIVE,
                App.status == "normal",
            )
        )
        .all()
    )

    tools: list[mcp_types.Tool] = []
    for server, app in servers:
        user_input_form = _get_app_user_input_form(app)
        schema = _build_tool_schema(app, user_input_form, server.parameters_dict)
        tool_name = _sanitize_tool_name(app.name)

        tools.append(
            mcp_types.Tool(
                name=tool_name,
                title=app.name,
                description=server.description or app.description or "",
                inputSchema=cast(dict[str, Any], schema),
            )
        )

    return mcp_types.ListToolsResult(tools=tools)


# ---------------------------------------------------------------------------
# tools/call — route to the correct app
# ---------------------------------------------------------------------------


def _handle_call_tool(
    workspace_id: str,
    request: mcp_types.ClientRequest,
    end_user: EndUser | None,
) -> mcp_types.CallToolResult:
    call_request = cast(mcp_types.CallToolRequest, request.root)
    tool_name = call_request.params.name
    arguments = call_request.params.arguments or {}

    # Find the matching app in the workspace
    app = _find_app_by_tool_name(workspace_id, tool_name)
    if app is None:
        raise ValueError(f"Tool not found: {tool_name}")

    if not end_user:
        raise ValueError("End user is required for tool execution")

    # Prepare arguments based on app mode
    args = _prepare_tool_arguments(app, arguments)

    response = AppGenerateService.generate(
        app,
        end_user,
        args,
        InvokeFrom.SERVICE_API,
        streaming=app.mode == AppMode.AGENT_CHAT,
    )

    answer = _extract_answer(app, response)
    return mcp_types.CallToolResult(
        content=[mcp_types.TextContent(text=answer, type="text")]
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _find_app_by_tool_name(workspace_id: str, tool_name: str) -> App | None:
    """
    Find an app in the workspace whose sanitized name matches *tool_name*.
    We also match by the raw app name for backward compatibility.
    """
    servers = (
        db.session.execute(
            select(AppMCPServer, App)
            .join(App, App.id == AppMCPServer.app_id)
            .where(
                AppMCPServer.tenant_id == workspace_id,
                AppMCPServer.status == AppMCPServerStatus.ACTIVE,
                App.status == "normal",
            )
        )
        .all()
    )

    for _server, app in servers:
        if _sanitize_tool_name(app.name) == tool_name or app.name == tool_name:
            return app
    return None


def _sanitize_tool_name(name: str) -> str:
    """
    Convert an app name to a valid MCP tool name.
    MCP tool names should be lowercase, alphanumeric with underscores/hyphens.
    """
    sanitized = ""
    for ch in name.strip().lower():
        if ch.isalnum() or ch in ("_", "-"):
            sanitized += ch
        elif ch == " ":
            sanitized += "_"
        else:
            sanitized += "_"
    # Collapse repeated underscores
    while "__" in sanitized:
        sanitized = sanitized.replace("__", "_")
    return sanitized.strip("_") or "unnamed_tool"


def _get_app_user_input_form(app: App) -> list[VariableEntity]:
    """Extract user input form variables from an app."""
    if app.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
        if not app.workflow:
            return []
        raw = app.workflow.user_input_form(to_old_structure=True)
    else:
        if not app.app_model_config:
            return []
        raw = app.app_model_config.to_dict().get("user_input_form", [])

    entities: list[VariableEntity] = []
    for item in raw:
        variable_type_raw: str = item.get("type", "") or list(item.keys())[0]
        try:
            variable_type = VariableEntityType(variable_type_raw)
        except ValueError:
            continue
        variable = item[variable_type_raw]
        entities.append(
            VariableEntity(
                type=variable_type,
                variable=variable.get("variable"),
                description=variable.get("description") or "",
                label=variable.get("label"),
                required=variable.get("required", False),
                max_length=variable.get("max_length"),
                options=variable.get("options") or [],
                json_schema=variable.get("json_schema"),
            )
        )
    return entities


def _build_tool_schema(
    app: App,
    user_input_form: list[VariableEntity],
    parameters_dict: dict[str, str],
) -> dict[str, Any]:
    """Build JSON Schema for a tool's input parameters."""
    properties: dict[str, dict[str, Any]] = {}
    required: list[str] = []

    for item in user_input_form:
        if item.type in (
            VariableEntityType.FILE,
            VariableEntityType.FILE_LIST,
            VariableEntityType.EXTERNAL_DATA_TOOL,
        ):
            continue

        properties[item.variable] = {}
        if item.required:
            required.append(item.variable)

        desc = parameters_dict.get(item.variable, item.description or "")
        properties[item.variable]["description"] = desc

        if item.type in (VariableEntityType.TEXT_INPUT, VariableEntityType.PARAGRAPH):
            properties[item.variable]["type"] = "string"
        elif item.type == VariableEntityType.SELECT:
            properties[item.variable]["type"] = "string"
            properties[item.variable]["enum"] = item.options
        elif item.type == VariableEntityType.NUMBER:
            properties[item.variable]["type"] = "number"
        elif item.type == VariableEntityType.CHECKBOX:
            properties[item.variable]["type"] = "boolean"
        elif item.type == VariableEntityType.JSON_OBJECT:
            properties[item.variable]["type"] = "object"
            if item.json_schema:
                for key in ("properties", "required", "additionalProperties"):
                    if key in item.json_schema:
                        properties[item.variable][key] = item.json_schema[key]

    if app.mode in {AppMode.COMPLETION, AppMode.WORKFLOW}:
        return {
            "type": "object",
            "properties": properties,
            "required": required,
        }
    else:
        return {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "User Input/Question content"},
                **properties,
            },
            "required": ["query", *required],
        }


def _prepare_tool_arguments(app: App, arguments: dict[str, Any]) -> dict[str, Any]:
    """Prepare arguments for app generation based on app mode."""
    mode = app.mode
    if mode == AppMode.WORKFLOW:
        return {"inputs": arguments}
    elif mode == AppMode.COMPLETION:
        return {"query": "", "inputs": arguments}
    else:
        args_copy = arguments.copy()
        query = args_copy.pop("query", "")
        return {"query": query, "inputs": args_copy}


def _extract_answer(app: App, response: Any) -> str:
    """Extract the answer text from an app generation response."""
    if isinstance(response, RateLimitGenerator):
        return _process_streaming(response)
    elif isinstance(response, Mapping):
        return _process_mapping(app, response)
    else:
        logger.warning("Unexpected response type: %s", type(response))
        return ""


def _process_streaming(response: RateLimitGenerator) -> str:
    answer = ""
    for item in response.generator:
        if isinstance(item, str) and item.startswith("data: "):
            try:
                json_str = item[6:].strip()
                parsed = json.loads(json_str)
                if parsed.get("event") == "agent_thought":
                    answer += parsed.get("thought", "")
            except json.JSONDecodeError:
                continue
    return answer


def _process_mapping(app: App, response: Mapping) -> str:
    mode = app.mode
    if mode in {AppMode.ADVANCED_CHAT, AppMode.COMPLETION, AppMode.CHAT, AppMode.AGENT_CHAT}:
        return response.get("answer", "")
    elif mode == AppMode.WORKFLOW:
        return json.dumps(response["data"]["outputs"], ensure_ascii=False)
    else:
        raise ValueError(f"Invalid app mode: {mode}")
