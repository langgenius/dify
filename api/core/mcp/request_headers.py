"""Capture inbound request headers for MCP `{{request.headers.*}}` resolution.

Agent V2 dispatches tool invocations through the inner API, where the live
Flask request only carries inner-auth headers. To keep dynamic MCP header
placeholders working there, the API boundary captures the original caller's
headers once and forwards them with the execution context.

Credential material is never forwarded: authorization headers, cookies, and
the inner-API key are stripped at capture time so a placeholder can never
exfiltrate them to a third-party MCP server.
"""

from flask import has_request_context, request

# Headers that must never be forwarded into MCP placeholder resolution.
_BLOCKED_HEADER_NAMES = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-inner-api-key",
    }
)


def capture_request_header_context() -> dict[str, str] | None:
    """Return the current request's headers minus credential material.

    Returns None outside a request context (e.g. Celery tasks) or when every
    header was filtered, so callers can omit the field entirely.
    """
    if not has_request_context():
        return None
    headers = {name: value for name, value in request.headers.items() if name.lower() not in _BLOCKED_HEADER_NAMES}
    return headers or None
