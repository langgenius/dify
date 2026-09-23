"""Native, non-cacheable access errors shared with the public gateway.

Keep these byte-level contracts local to their owning surfaces: Service API and
OpenAPI authentication, unavailable MCP identities, and missing trigger endpoints.
Successful responses and other APIs retain their existing serialization.
"""

import json
from dataclasses import dataclass
from typing import Any

from flask import Blueprint, Response, request
from werkzeug.exceptions import HTTPException, NotFound
from werkzeug.wrappers import Response as WerkzeugResponse

MCP_ERROR_BODY_LIMIT = 64 * 1024
MCP_ERROR_MAX_DEPTH = 64
MISSING_BEARER_MESSAGE = "Authorization header must be provided and start with 'Bearer'"


def _json(value: Any) -> str:
    # Match Go's non-HTML-escaping JSON encoder, including its JS-safe separators.
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False)
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def register_auth_error_response(blueprint: Blueprint, *, www_authenticate: str | None = None) -> None:
    """Canonicalize local final 401 bodies, preserving native message/extra fields.

    The Service API supplies its Bearer challenge explicitly. OpenAPI retains its
    own challenge and OAuth error fields; other surfaces do not register this hook.
    """

    @blueprint.after_request
    def auth_error_response(response: Response) -> Response:
        if response.status_code != 401 or not response.is_json or response.is_streamed:
            return response
        payload = response.get_json(silent=True)
        if not isinstance(payload, dict):
            return response
        response.set_data(_json(payload))
        response.headers["Content-Type"] = "application/json"
        response.headers["Cache-Control"] = "no-store"
        if www_authenticate is not None:
            response.headers["WWW-Authenticate"] = www_authenticate
        return response


@dataclass(frozen=True)
class _JSONNumber:
    """An already-validated JSON number lexeme, without float/int conversion."""

    value: str


def _within_json_depth(body: bytes) -> bool:
    """Match the gateway's bounded parser; brackets inside strings do not count."""
    depth = 0
    in_string = False
    escaped = False
    for char in body:
        if in_string:
            if escaped:
                escaped = False
            elif char == 92:  # backslash
                escaped = True
            elif char == 34:  # quote
                in_string = False
        elif char == 34:
            in_string = True
        elif char in (91, 123):  # array or object
            depth += 1
            if depth > MCP_ERROR_MAX_DEPTH:
                return False
        elif char in (93, 125):
            depth -= 1
    return True


def _invalid_constant(_value: str) -> None:
    raise ValueError("Non-JSON numeric constant")


def _parse_mcp_error_request_id(body: bytes) -> str:
    """Parse only an error response's ID, retaining its original numeric lexeme."""
    try:
        if len(body) > MCP_ERROR_BODY_LIMIT or not _within_json_depth(body):
            return "null"
        payload = json.loads(
            body.decode("utf-8"),
            parse_int=_JSONNumber,
            parse_float=_JSONNumber,
            parse_constant=_invalid_constant,
        )
        if not isinstance(payload, dict):
            return "null"
        request_id = payload.get("id")
        if isinstance(request_id, _JSONNumber):
            return request_id.value
        if isinstance(request_id, str):
            # Reject unpaired surrogates instead of creating invalid UTF-8.
            request_id.encode("utf-8")
            return _json(request_id)
    except (ValueError, UnicodeError, RecursionError):
        pass
    return "null"


def _mcp_request_id() -> str:
    """Read bounded raw bytes, including bodies already cached by request logging.

    Werkzeug's public get_data() reuses _cached_data but otherwise reads the
    entire stream. Its stream property does not replay that cache. Keep this
    read-only private-attribute compatibility here: it avoids unbounded reads
    for unknown Content-Length and never installs a partial request cache.
    """
    try:
        if request.content_length is not None and request.content_length > MCP_ERROR_BODY_LIMIT:
            return "null"
        cached = getattr(request, "_cached_data", None)
        if cached is not None:
            return _parse_mcp_error_request_id(cached) if isinstance(cached, bytes) else "null"
        body = request.stream.read(MCP_ERROR_BODY_LIMIT + 1)
    except HTTPException:
        return "null"
    return _parse_mcp_error_request_id(body)


def mcp_server_not_found_response() -> Response:
    """Opaque MCP lookup failure; no app/server identity or policy is disclosed."""
    body = '{"error":{"code":-32600,"message":"Server Not Found"},"id":' + _mcp_request_id() + ',"jsonrpc":"2.0"}'
    return Response(body, status=404, content_type="application/json", headers={"Cache-Control": "no-store"})


def webhook_not_found_response() -> WerkzeugResponse:
    """Use Werkzeug's normal HTML 404 without caller IDs or internal detail."""
    response = NotFound().get_response()
    response.headers["Cache-Control"] = "no-store"
    return response


def plugin_endpoint_not_found_response() -> Response:
    """Plugin callbacks own a JSON not-found shape, unlike native Webhooks."""
    return Response(
        _json({"error": "Endpoint not found"}),
        status=404,
        content_type="application/json",
        headers={"Cache-Control": "no-store"},
    )
