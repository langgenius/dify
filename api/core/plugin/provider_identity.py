"""Normalize persisted provider identities for plugin-daemon transport."""

from models.provider_ids import GenericProviderID


def normalize_plugin_daemon_provider_identity(
    provider_id: GenericProviderID,
    plugin_id: str | None = None,
) -> tuple[str, str]:
    """Return the stable plugin ID and short provider name expected by plugin-daemon."""
    if plugin_id:
        if len(plugin_id.split("/")) != 2:
            raise ValueError(f"Invalid plugin id {plugin_id}")
        normalized_plugin_id = plugin_id.split(":", 1)[0].split("@", 1)[0]
    else:
        normalized_plugin_id = provider_id.plugin_id
    normalized_provider_id = GenericProviderID(f"{normalized_plugin_id}/{provider_id.provider_name}")
    return normalized_provider_id.plugin_id, provider_id.provider_name
