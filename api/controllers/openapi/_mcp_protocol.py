"""The JSON-RPC envelope of the MCP endpoint: reading a message, building a reply.

Parsing follows the app-level MCP server (``controllers/mcp/mcp.py``), which this module
does not import: a request is tried first, then a notification.
"""

from __future__ import annotations

from typing import Any, Final, get_args

from pydantic import ValidationError

from core.mcp import types as mcp_types

JSONRPC_VERSION: Final = "2.0"
_JSONRPC_KEY: Final = "jsonrpc"
_METHOD_KEY: Final = "method"
_ID_KEY: Final = "id"
_DUMP_OPTIONS: Final = {"mode": "json", "by_alias": True, "exclude_none": True}

_MCP_METHODS: Final = frozenset(
    method
    for message_type in (mcp_types.ClientRequest, mcp_types.ClientNotification)
    for model in get_args(message_type.model_fields["root"].annotation)
    for method in get_args(model.model_fields["method"].annotation)
)


class McpRequestError(Exception):
    """A message that cannot be served, with the JSON-RPC error code that names why."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _is_request_id(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    return isinstance(value, int | str)


def request_id_of(body: Any) -> int | str | None:
    """Postcondition: the message's ``id`` when it is an integer or a string, else None."""
    if not isinstance(body, dict):
        return None
    value = body.get(_ID_KEY)
    if not _is_request_id(value):
        return None
    return value


def has_id(body: Any) -> bool:
    """Postcondition: True when ``body`` is an object that carries an ``id`` key."""
    return isinstance(body, dict) and _ID_KEY in body


def parse_message(body: Any) -> mcp_types.ClientRequest | mcp_types.ClientNotification:
    """Read one JSON-RPC message.

    Precondition: ``body`` is the decoded JSON body, or None when it did not decode.
    Postcondition: a request or a notification model; raises ``McpRequestError`` with
    PARSE_ERROR for a body that is not an object (None included), INVALID_REQUEST for a batch
    array, a wrong ``jsonrpc`` or ``method`` or an ``id`` that is not an integer or string,
    METHOD_NOT_FOUND for an unknown method, INVALID_PARAMS for params that do not fit.
    """
    if isinstance(body, list):
        raise McpRequestError(mcp_types.INVALID_REQUEST, "Batch requests are not supported")
    if not isinstance(body, dict):
        raise McpRequestError(mcp_types.PARSE_ERROR, "The body is not a JSON object")
    if body.get(_JSONRPC_KEY) != JSONRPC_VERSION:
        raise McpRequestError(mcp_types.INVALID_REQUEST, "jsonrpc must be 2.0")
    method = body.get(_METHOD_KEY)
    if not isinstance(method, str):
        raise McpRequestError(mcp_types.INVALID_REQUEST, "method must be a string")
    if has_id(body) and not _is_request_id(body[_ID_KEY]):
        raise McpRequestError(mcp_types.INVALID_REQUEST, "id must be an integer or a string")
    if method not in _MCP_METHODS:
        raise McpRequestError(mcp_types.METHOD_NOT_FOUND, "Method not found")
    try:
        return mcp_types.ClientRequest.model_validate(body)
    except ValidationError:
        pass
    try:
        return mcp_types.ClientNotification.model_validate(body)
    except ValidationError as error:
        raise McpRequestError(mcp_types.INVALID_PARAMS, "Invalid MCP request parameters") from error


def success(request_id: int | str, result: mcp_types.Result) -> dict[str, Any]:
    """Postcondition: a JSON-RPC success object holding ``result`` as the wire form of the model."""
    return {
        _JSONRPC_KEY: JSONRPC_VERSION,
        _ID_KEY: request_id,
        "result": result.model_dump(**_DUMP_OPTIONS),
    }


def failure(request_id: int | str | None, code: int, message: str) -> dict[str, Any]:
    """Postcondition: a JSON-RPC error object; ``request_id`` None stays a null id."""
    error = mcp_types.ErrorData(code=code, message=message)
    return {
        _JSONRPC_KEY: JSONRPC_VERSION,
        _ID_KEY: request_id,
        "error": error.model_dump(**_DUMP_OPTIONS),
    }


__all__ = ["McpRequestError", "failure", "has_id", "parse_message", "request_id_of", "success"]
