from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from configs import dify_config
from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.base import BasePluginEntity


class EndpointDeclaration(BaseModel):
    """
    declaration of an endpoint
    """

    path: str
    method: str
    hidden: bool = Field(default=False)


class EndpointProviderDeclaration(BaseModel):
    """
    declaration of an endpoint group
    """

    settings: list[ProviderConfig] = Field(default_factory=list)
    endpoints: Optional[list[EndpointDeclaration]] = Field(default_factory=list)


class EndpointEntity(BasePluginEntity):
    """
    entity of an endpoint
    """

    settings: dict
    tenant_id: str
    plugin_id: str
    expired_at: datetime
    declaration: EndpointProviderDeclaration = Field(default_factory=EndpointProviderDeclaration)


class EndpointEntityWithInstance(EndpointEntity):
    name: str
    enabled: bool
    url: str
    hook_id: str

    @model_validator(mode="before")
    @classmethod
    def render_url_template(cls, values):
        if "url" not in values:
            url_template = dify_config.ENDPOINT_URL_TEMPLATE
            values["url"] = url_template.replace("{hook_id}", values["hook_id"])
        return values
