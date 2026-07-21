"""Shared plugin-daemon transport helpers.

These helpers define the common request-payload and nested-error semantics used
by Dify Agent's LLM and tools daemon clients so the two transport adapters do
not drift when the daemon protocol evolves.
"""

from __future__ import annotations

import json
import os
from typing import TypedDict

from pydantic import BaseModel

# Maximum recursion depth when unwrapping nested PluginInvokeError payloads.
# Configurable via environment variable PLUGIN_DAEMON_MAX_UNWRAP_DEPTH.
MAX_UNWRAP_DEPTH: int = int(os.getenv("PLUGIN_DAEMON_MAX_UNWRAP_DEPTH", "5"))


class PluginDaemonErrorPayload(TypedDict):
    """Decoded plugin-daemon error payload."""

    error_type: str
    message: str


def to_plugin_daemon_jsonable(value: object) -> object:
    """Convert nested request data into JSON-safe daemon payload values."""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {key: to_plugin_daemon_jsonable(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [to_plugin_daemon_jsonable(item) for item in value]
    return value


def decode_plugin_daemon_error_payload(raw_message: str) -> PluginDaemonErrorPayload | None:
    """Decode one plugin-daemon JSON error payload if present."""
    try:
        parsed = json.loads(raw_message)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    error_type = parsed.get("error_type")
    message = parsed.get("message")
    if not isinstance(error_type, str) or not isinstance(message, str):
        return None
    return {"error_type": error_type, "message": message}


def unwrap_plugin_daemon_error(
    *,
    error_type: str,
    message: str,
) -> PluginDaemonErrorPayload:
    """Unwrap nested ``PluginInvokeError`` payloads to their effective error.

    Iteratively peels back nested ``PluginInvokeError`` wrappers up to
    ``MAX_UNWRAP_DEPTH`` times, returning the innermost concrete error type
    and message.  This replaces the previous recursive implementation, which
    could cause a stack overflow for pathologically deep error chains.
    """
    current_type = error_type
    current_message = message

    for _ in range(MAX_UNWRAP_DEPTH):
        if current_type != "PluginInvokeError":
            break
        nested_error = decode_plugin_daemon_error_payload(current_message)
        if nested_error is None:
            break
        current_type = nested_error["error_type"]
        current_message = nested_error["message"]

    return {"error_type": current_type, "message": current_message}


__all__ = [
    "MAX_UNWRAP_DEPTH",
    "PluginDaemonErrorPayload",
    "decode_plugin_daemon_error_payload",
    "to_plugin_daemon_jsonable",
    "unwrap_plugin_daemon_error",
]
