from core.plugin.entities.base import BasePluginEntity


class PluginEntity(BasePluginEntity):
    name: str
    plugin_id: str
    plugin_unique_identifier: str
    tenant_id: str
    endpoints_setups: int
    endpoints_active: int
