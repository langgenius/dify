"""Normalize persisted provider identities for plugin-daemon transport."""

from models.provider_ids import GenericProviderID


def normalize_plugin_daemon_provider_identity(
    provider_id: GenericProviderID,
    plugin_id: str | None = None,
) -> tuple[str, str]:
    """Return the stable plugin ID and short provider name expected by plugin-daemon.

    Explicit three-segment plugin IDs are legacy persisted provider IDs. They are
    normalized through the concrete provider-ID type to preserve model and tool aliases.
    """
    if plugin_id:
        plugin_id_parts = plugin_id.split("/")
        if len(plugin_id_parts) == 3:
            normalized_plugin_id = type(provider_id)(plugin_id).plugin_id
        elif len(plugin_id_parts) == 2:
            normalized_plugin_id = plugin_id.split(":", 1)[0].split("@", 1)[0]
        else:
            raise ValueError(f"Invalid plugin id {plugin_id}")
    else:
        normalized_plugin_id = provider_id.plugin_id
    normalized_provider_id = GenericProviderID(f"{normalized_plugin_id}/{provider_id.provider_name}")
    return normalized_provider_id.plugin_id, provider_id.provider_name
