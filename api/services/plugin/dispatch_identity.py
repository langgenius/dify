"""Bind daemon dispatches to the plugin declaration used by the caller."""

from typing import NotRequired

from typing_extensions import TypedDict

PLUGIN_IDENTIFIER_HEADER = "X-Plugin-Unique-Identifier"


class PluginDispatchIdentity(TypedDict, closed=True):
    plugin_unique_identifier: NotRequired[str]


def plugin_dispatch_headers(plugin_id: str, identifier: str | None) -> dict[str, str]:
    headers = {"X-Plugin-ID": plugin_id, "Content-Type": "application/json"}
    if identifier is not None:
        headers[PLUGIN_IDENTIFIER_HEADER] = identifier
    return headers


def prepare_dispatch_identity(path: str, headers: dict[str, str], identifier: str | None) -> None:
    parts = path.split("/")
    if len(parts) < 4 or parts[0] != "plugin" or parts[2] != "dispatch":
        return

    identifier = headers.get(PLUGIN_IDENTIFIER_HEADER) or identifier
    if identifier is None:
        # Legacy calls leave installation resolution to the daemon.
        return

    plugin_id = headers.get("X-Plugin-ID")
    if not plugin_id:
        raise ValueError("X-Plugin-ID is required for plugin dispatch")

    if identifier.partition(":")[0] != plugin_id:
        raise ValueError("Plugin unique identifier does not match X-Plugin-ID")
    headers[PLUGIN_IDENTIFIER_HEADER] = identifier
