from collections.abc import Mapping
from datetime import datetime

from pydantic import BaseModel, Field

from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.base import BasePluginEntity


class EndpointDeclaration(BaseModel):
    """
    declaration of an endpoint
    """

    settings: Mapping[str, ProviderConfig] = Field(default_factory=Mapping)


class EndpointEntity(BasePluginEntity):
    """
    entity of an endpoint
    """

    settings: dict
    name: str
    hook_id: str
    tenant_id: str
    plugin_id: str
    expired_at: datetime
    declaration: EndpointDeclaration = Field(default_factory=EndpointDeclaration)
