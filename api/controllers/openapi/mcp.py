"""POST /openapi/v1/mcp: the MCP endpoint, one JSON-RPC message per request, JSON replies, no sessions.

The route is not an operation: it has no ``@endpoint`` and is not in the catalog. It holds no login
code. ``initialize`` and ``tools/list`` run the router's ``admit_bearer``, the step every operation
starts with; ``tools/call`` runs the named operation, which authenticates once; ``ping`` and
notifications do not authenticate.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, Final
from urllib.parse import urlsplit

from flask import Response, request
from flask_restx import Resource
from werkzeug.exceptions import NotFound, RequestEntityTooLarge, Unauthorized

from configs import dify_config
from controllers.openapi import openapi_ns
from controllers.openapi._mcp_call import AUTHORIZATION_HEADER, JSON_CONTENT_TYPE, TRACE_ID_HEADER
from controllers.openapi._mcp_protocol import McpRequestError, failure, has_id, parse_message, request_id_of, success
from controllers.openapi._mcp_tools import MCP_INSTRUCTIONS, McpCaller, Unauthenticated, run_tool, tool_list
from controllers.openapi.auth.router import admit_bearer
from core.mcp import types as mcp_types
from core.mcp.server.streamable_http import handle_initialize, handle_ping, negotiate_protocol_version
from libs.oauth_bearer import extract_bearer
from services.dsl_content import DSL_MAX_SIZE

PROTOCOL_VERSION_HEADER: Final = "MCP-Protocol-Version"
ORIGIN_HEADER: Final = "Origin"
_ORIGIN_NOT_ALLOWED_MESSAGE: Final = "Origin not allowed"
_BODY_ENVELOPE_BYTES: Final = 1024 * 1024
# The largest JSON op input is a DSL import (DSL_MAX_SIZE) wrapped in a tool call.
MCP_MAX_BODY_BYTES: Final = DSL_MAX_SIZE + _BODY_ENVELOPE_BYTES
_BODY_TOO_LARGE_MESSAGE: Final = "Request body too large"
UNAUTHORIZED_BODY: Final = {"code": "unauthorized", "message": "invalid bearer", "status": HTTPStatus.UNAUTHORIZED}


@dataclass(frozen=True, slots=True, kw_only=True)
class _Call:
    """One parsed MCP request: its id, the request model and who sent it."""

    request_id: int | str
    message: Any  # the concrete request model, e.g. ``mcp_types.ListToolsRequest``
    caller: McpCaller


type _Handler = Callable[[_Call], dict[str, Any]]


def _json_response(
    body: Mapping[str, Any], status: int = HTTPStatus.OK, headers: Mapping[str, str] | None = None
) -> Response:
    """Postcondition: a JSON response with ``body``, the given status and extra ``headers``."""
    return Response(json.dumps(body), status=status, mimetype=JSON_CONTENT_TYPE, headers=dict(headers or {}))


def _origin_allowed(origin: str) -> bool:
    """Postcondition: True when ``origin`` is this server's own (same host and port as the request, any scheme, so a
    TLS-terminating proxy does not turn the server's own https origin away) or is listed in
    ``OPENAPI_CORS_ALLOW_ORIGINS``. MCP transport rule: servers validate Origin against DNS rebinding."""
    if origin.rstrip("/") in {allowed.rstrip("/") for allowed in dify_config.OPENAPI_CORS_ALLOW_ORIGINS}:
        return True
    parts = urlsplit(origin)
    if parts.scheme not in {"http", "https"}:
        return False
    return parts.netloc == request.host


def _accepted() -> Response:
    """Postcondition: a 202 response with no body."""
    return Response("", status=HTTPStatus.ACCEPTED)


def _admit() -> None:
    """Run ``admit_bearer``; its other errors propagate as for any operation.

    Postcondition: a missing or invalid bearer answers 401 with ``UNAUTHORIZED_BODY``, as a tool call's 401 does.
    """
    try:
        admit_bearer()
    except Unauthorized as error:
        raise Unauthorized(UNAUTHORIZED_BODY["message"]) from error


def _initialize(call: _Call) -> dict[str, Any]:
    """Precondition: ``call`` holds an ``initialize`` request, inside a Flask request.

    Postcondition: the bearer was admitted and the reply carries the negotiated version and the
    instructions; raises as ``_admit`` does.
    """
    _admit()
    return success(call.request_id, handle_initialize(MCP_INSTRUCTIONS, call.message.params.protocolVersion))


def _list_tools(call: _Call) -> dict[str, Any]:
    """Precondition: ``call`` holds a ``tools/list`` request, inside a Flask request.

    Postcondition: the bearer was admitted and the reply lists the four tools; raises as ``_admit`` does.
    """
    _admit()
    return success(call.request_id, mcp_types.ListToolsResult(tools=tool_list()))


def _call_tool(call: _Call) -> dict[str, Any]:
    """Precondition: ``call`` holds a ``tools/call`` request, inside a Flask request.

    Postcondition: an INVALID_PARAMS error for a name that is not one of the four tools, else
    the tool's result; raises ``Unauthenticated`` when the operation answers 401.
    """
    params = call.message.params
    if params.name not in {tool.name for tool in tool_list()}:
        return failure(call.request_id, mcp_types.INVALID_PARAMS, f"Unknown tool: {params.name}")
    result = run_tool(params.name, params.arguments or {}, call.caller)
    return success(call.request_id, result)


def _ping(call: _Call) -> dict[str, Any]:
    """Postcondition: the empty ping result; no login check."""
    return success(call.request_id, handle_ping())


def _method_not_found(call: _Call) -> dict[str, Any]:
    """Postcondition: a METHOD_NOT_FOUND error for a method the route knows of but does not serve."""
    return failure(call.request_id, mcp_types.METHOD_NOT_FOUND, "Method not found")


_HANDLERS: Final[Mapping[type, _Handler]] = {
    mcp_types.InitializeRequest: _initialize,
    mcp_types.ListToolsRequest: _list_tools,
    mcp_types.CallToolRequest: _call_tool,
    mcp_types.PingRequest: _ping,
}


@openapi_ns.route("/mcp")
class OpenApiMcpApi(Resource):
    """The MCP endpoint: one JSON-RPC message per POST; it is not an operation and is not in the catalog."""

    def post(self):
        """Serve one MCP JSON-RPC message.

        Precondition: a POST to the openapi blueprint. Postcondition: 404, as for an unknown path, before
        anything else when ``OPENAPI_MCP_ENABLED`` is false. Otherwise 200 with a JSON-RPC reply
        (result, or error for an unsupported protocol version or tool name); 202 with no body for
        a notification or an unparsable message that has no ``id``; 400 with a JSON-RPC error for
        any other unparsable message; 413 with a JSON-RPC error when the body is above
        ``MCP_MAX_BODY_BYTES`` and sent with a ``Content-Length`` (checked before the body is read and
        before any login check); a body above the cap sent without a ``Content-Length`` (chunked) is
        cut at the cap and answers 400 with a JSON-RPC parse error; 403 with a JSON-RPC error, before the body is
        read, when an ``Origin`` header is present and is neither this server's own nor in
        ``OPENAPI_CORS_ALLOW_ORIGINS`` (no ``Origin``: unchanged). ``initialize`` and ``tools/list``
        answer as any request on this surface does, with its error body and headers: 401 for a missing
        or invalid bearer, 429 with Retry-After above the per-token limit, 403 for a broken licence, 503
        when bearer login is off. ``ping``, notifications and ``dify_find`` have no login check.
        """
        # response-contract:ignore MCP route returns a Flask Response built from a JSON-RPC message
        if not dify_config.OPENAPI_MCP_ENABLED:
            raise NotFound()
        origin = request.headers.get(ORIGIN_HEADER)
        if origin is not None and not _origin_allowed(origin):
            return _json_response(
                failure(None, mcp_types.INVALID_REQUEST, _ORIGIN_NOT_ALLOWED_MESSAGE), HTTPStatus.FORBIDDEN
            )
        request.max_content_length = MCP_MAX_BODY_BYTES
        try:
            body = request.get_json(silent=True)
        except RequestEntityTooLarge:
            return _json_response(
                failure(None, mcp_types.INVALID_REQUEST, _BODY_TOO_LARGE_MESSAGE), HTTPStatus.REQUEST_ENTITY_TOO_LARGE
            )
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
        caller = McpCaller(
            authorization=request.headers.get(AUTHORIZATION_HEADER),
            token=extract_bearer(request),
            trace_id=request.headers.get(TRACE_ID_HEADER),
            protocol_version=protocol_version,
        )
        call = _Call(request_id=request_id, message=message.root, caller=caller)
        handler = _HANDLERS.get(type(message.root), _method_not_found)
        try:
            return _json_response(handler(call))
        except Unauthenticated as error:
            return _json_response(UNAUTHORIZED_BODY, HTTPStatus.UNAUTHORIZED, error.headers)
