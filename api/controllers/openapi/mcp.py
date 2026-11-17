"""POST /openapi/v1/mcp: the MCP endpoint, one JSON-RPC message per request, JSON replies, no sessions.

The route is not an operation: it has no ``@endpoint`` and is not in the catalog. It holds no login
code. ``initialize`` and ``tools/list`` run ``describe.account`` in-process, which authenticates
once; ``tools/call`` runs the named operation, which authenticates once; ``ping`` and notifications
do not authenticate.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, Final

from flask import Response, request
from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._mcp_call import AUTHORIZATION_HEADER, TRACE_ID_HEADER, OpCall, OpResult, call_op
from controllers.openapi._mcp_protocol import McpRequestError, failure, has_id, parse_message, request_id_of, success
from controllers.openapi._mcp_tools import MCP_INSTRUCTIONS, Unauthenticated, run_tool, tool_list
from core.mcp import types as mcp_types
from core.mcp.server.streamable_http import handle_initialize, handle_ping, negotiate_protocol_version

PROTOCOL_VERSION_HEADER: Final = "MCP-Protocol-Version"
JSON_MIMETYPE: Final = "application/json"
ACCOUNT_OP: Final = "describe.account"
UNAUTHORIZED_BODY: Final = {"code": "unauthorized", "message": "invalid bearer", "status": HTTPStatus.UNAUTHORIZED}
_PASSED_UPSTREAM_HEADERS: Final = ("Retry-After",)


class _LoginCheckFailed(Exception):  # noqa: N818
    """The login check hit a server error: the request answers with the operation's own status and body."""

    def __init__(self, result: OpResult) -> None:
        super().__init__("login check failed")
        self.result = result


@dataclass(frozen=True, slots=True, kw_only=True)
class _Call:
    request_id: int | str
    message: Any  # the concrete request model, e.g. ``mcp_types.ListToolsRequest``
    authorization: str | None
    trace_id: str | None
    protocol_version: str


type _Handler = Callable[[_Call], dict[str, Any]]


def _json_response(
    body: Mapping[str, Any], status: int = HTTPStatus.OK, headers: Mapping[str, str] | None = None
) -> Response:
    return Response(json.dumps(body), status=status, mimetype=JSON_MIMETYPE, headers=dict(headers or {}))


def _accepted() -> Response:
    return Response("", status=HTTPStatus.ACCEPTED)


def _check_login(call: _Call) -> None:
    """Precondition: inside a Flask request. Postcondition: returns when the token was not refused as unauthenticated.

    Runs ``describe.account`` in-process. A 401 raises ``Unauthenticated`` with the headers it
    carried; a 5xx raises ``_LoginCheckFailed``; any other status passes (a 403 means a token kind
    that operation does not serve; a 429 or 404 says nothing against the token).
    """
    result = call_op(OpCall(op=ACCOUNT_OP, input={}, authorization=call.authorization, trace_id=call.trace_id))
    if result.status == HTTPStatus.UNAUTHORIZED:
        raise Unauthenticated.from_result(result)
    if result.status >= HTTPStatus.INTERNAL_SERVER_ERROR:
        raise _LoginCheckFailed(result)


def _initialize(call: _Call) -> dict[str, Any]:
    _check_login(call)
    return success(call.request_id, handle_initialize(MCP_INSTRUCTIONS, call.message.params.protocolVersion))


def _list_tools(call: _Call) -> dict[str, Any]:
    _check_login(call)
    return success(call.request_id, mcp_types.ListToolsResult(tools=tool_list()))


def _call_tool(call: _Call) -> dict[str, Any]:
    params = call.message.params
    if params.name not in {tool.name for tool in tool_list()}:
        return failure(call.request_id, mcp_types.INVALID_PARAMS, f"Unknown tool: {params.name}")
    result = run_tool(
        params.name,
        params.arguments or {},
        authorization=call.authorization,
        trace_id=call.trace_id,
        protocol_version=call.protocol_version,
    )
    return success(call.request_id, result)


def _ping(call: _Call) -> dict[str, Any]:
    return success(call.request_id, handle_ping())


def _method_not_found(call: _Call) -> dict[str, Any]:
    return failure(call.request_id, mcp_types.METHOD_NOT_FOUND, "Method not found")


_HANDLERS: Final[Mapping[type, _Handler]] = {
    mcp_types.InitializeRequest: _initialize,
    mcp_types.ListToolsRequest: _list_tools,
    mcp_types.CallToolRequest: _call_tool,
    mcp_types.PingRequest: _ping,
}


def _unauthorized(error: Unauthenticated) -> Response:
    return _json_response(UNAUTHORIZED_BODY, HTTPStatus.UNAUTHORIZED, error.headers)


def _upstream_failure(error: _LoginCheckFailed) -> Response:
    result = error.result
    headers = {name: result.headers[name] for name in _PASSED_UPSTREAM_HEADERS if name in result.headers}
    if not result.is_json:
        return Response("", status=result.status, headers=headers)
    return _json_response(result.body, result.status, headers)


@openapi_ns.route("/mcp")
class OpenApiMcpApi(Resource):
    def post(self):
        """Serve one MCP JSON-RPC message.

        Precondition: a POST to the openapi blueprint. Postcondition: 200 with a JSON-RPC reply
        (result, or error for an unsupported protocol version or tool name); 202 with no body for
        a notification or an unparsable message that has no ``id``; 400 with a JSON-RPC error for
        any other unparsable message; 401 when the token is not real; the login check's own status
        when it answers a server error.
        """
        # response-contract:ignore MCP route returns a Flask Response built from a JSON-RPC message
        body = request.get_json(silent=True)
        try:
            message = parse_message(body)
        except McpRequestError as error:
            if not isinstance(body, dict):
                return _json_response(failure(None, error.code, error.message), HTTPStatus.BAD_REQUEST)
            if not has_id(body):
                return _accepted()
            return _json_response(failure(request_id_of(body), error.code, error.message), HTTPStatus.BAD_REQUEST)
        request_id = request_id_of(body)
        if isinstance(message, mcp_types.ClientNotification):
            return _accepted()
        if request_id is None:
            return _accepted()
        header_value = request.headers.get(PROTOCOL_VERSION_HEADER)
        is_initialize = isinstance(message.root, mcp_types.InitializeRequest)
        protocol_version = negotiate_protocol_version(header_value, is_initialize)
        if protocol_version is None:
            return _json_response(
                failure(request_id, mcp_types.INVALID_REQUEST, f"Unsupported MCP-Protocol-Version: {header_value}")
            )
        call = _Call(
            request_id=request_id,
            message=message.root,
            authorization=request.headers.get(AUTHORIZATION_HEADER),
            trace_id=request.headers.get(TRACE_ID_HEADER),
            protocol_version=protocol_version,
        )
        handler = _HANDLERS.get(type(message.root), _method_not_found)
        try:
            return _json_response(handler(call))
        except Unauthenticated as error:
            return _unauthorized(error)
        except _LoginCheckFailed as error:
            return _upstream_failure(error)
