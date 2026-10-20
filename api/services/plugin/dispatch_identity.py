"""Bind daemon dispatches to the plugin declaration used by the caller."""

PLUGIN_IDENTIFIER_HEADER = "X-Plugin-Unique-Identifier"


def prepare_dispatch_identity(path: str, headers: dict[str, str], identifier: str | None) -> None:
    parts = path.split("/")
    if len(parts) < 4 or parts[0] != "plugin" or parts[2] != "dispatch":
        return

    plugin_id = headers.get("X-Plugin-ID")
    if not plugin_id:
        raise ValueError("X-Plugin-ID is required for plugin dispatch")

    identifier = headers.get(PLUGIN_IDENTIFIER_HEADER) or identifier
    if identifier is None:
        # Legacy calls leave installation resolution to the daemon.
        return

    if identifier.partition(":")[0] != plugin_id:
        raise ValueError("Plugin unique identifier does not match X-Plugin-ID")
    headers[PLUGIN_IDENTIFIER_HEADER] = identifier
