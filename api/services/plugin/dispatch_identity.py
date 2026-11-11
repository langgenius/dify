"""Bind daemon dispatches to the plugin declaration used by the caller."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, NotRequired

from typing_extensions import TypedDict

PLUGIN_IDENTIFIER_HEADER = "X-Plugin-Unique-Identifier"


@dataclass(frozen=True, slots=True)
class PluginOAuthClientConfig:
    """OAuth credentials paired with the declaration used to resolve them."""

    plugin_unique_identifier: str
    credentials: Mapping[str, Any] = field(repr=False)


class PluginDispatchIdentity(TypedDict, closed=True):
    plugin_unique_identifier: NotRequired[str]


def plugin_dispatch_headers(plugin_id: str, identifier: str | None) -> dict[str, str]:
    headers = {"X-Plugin-ID": plugin_id, "Content-Type": "application/json"}
    if identifier is not None:
        headers[PLUGIN_IDENTIFIER_HEADER] = identifier
    return headers


def prepare_dispatch_identity(path: str, headers: dict[str, str], identifier: str | None) -> None:
    """Bind matching identities for tenant and direct dispatch without installation lookup.

    Legacy tenant routes may omit an identifier. Direct routes require an exact
    identifier and plugin ID before any request can send server-owned credentials.
    Non-dispatch requests remain unchanged.
    """
    parts = path.split("/")
    tenant_dispatch = len(parts) >= 4 and parts[0] == "plugin" and parts[2] == "dispatch"
    direct_dispatch = parts[:3] == ["v2", "invoke", "dispatch"]
    if not tenant_dispatch and not direct_dispatch:
        return

    identifier = headers.get(PLUGIN_IDENTIFIER_HEADER) or identifier
    if identifier is None:
        if direct_dispatch:
            raise ValueError("A plugin unique identifier is required for direct dispatch")
        # Legacy calls leave installation resolution to the daemon.
        return

    plugin_id = headers.get("X-Plugin-ID")
    if not plugin_id:
        raise ValueError("X-Plugin-ID is required for plugin dispatch")

    if identifier.partition(":")[0] != plugin_id:
        raise ValueError("Plugin unique identifier does not match X-Plugin-ID")
    headers[PLUGIN_IDENTIFIER_HEADER] = identifier
