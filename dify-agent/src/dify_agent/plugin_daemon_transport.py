"""Shared plugin-daemon transport helpers.

These helpers define the common request-payload and nested-error semantics used
by Dify Agent's LLM and tools daemon clients so the two transport adapters do
not drift when the daemon protocol evolves.
"""

from __future__ import annotations

import json
from typing import TypedDict

from pydantic import BaseModel


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
    """Unwrap nested ``PluginInvokeError`` payloads to their effective error."""
    if error_type == "PluginInvokeError":
        nested_error = decode_plugin_daemon_error_payload(message)
        if nested_error is not None:
            return unwrap_plugin_daemon_error(
                error_type=nested_error["error_type"],
                message=nested_error["message"],
            )
    return {"error_type": error_type, "message": message}


__all__ = [
    "PluginDaemonErrorPayload",
    "decode_plugin_daemon_error_payload",
    "to_plugin_daemon_jsonable",
    "unwrap_plugin_daemon_error",
]
