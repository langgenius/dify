from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from configs import dify_config
from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.base import BasePluginEntity


class EndpointDeclaration(BaseModel):
    """
    declaration of an endpoint
    """

    settings: list[ProviderConfig] = Field(default_factory=list)


class EndpointEntity(BasePluginEntity):
    """
    entity of an endpoint
    """

    settings: dict
    name: str
    enabled: bool
    url: str
    hook_id: str
    tenant_id: str
    plugin_id: str
    expired_at: datetime
    declaration: EndpointDeclaration = Field(default_factory=EndpointDeclaration)

    @model_validator(mode="before")
    @classmethod
    def render_url_template(cls, values):
        if "url" not in values:
            url_template = dify_config.ENDPOINT_URL_TEMPLATE
            values["url"] = url_template.replace("{hook_id}", values["hook_id"])
        return values
