from datetime import datetime

from core.plugin.entities.base import BasePluginEntity


class EndpointEntity(BasePluginEntity):
    settings: dict
    hook_id: str
    tenant_id: str
    plugin_id: str
    expired_at: datetime
