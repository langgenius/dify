from pydantic import BaseModel, Field, model_validator

from core.model_runtime.entities.provider_entities import ProviderEntity
from core.plugin.entities.endpoint import EndpointProviderDeclaration
from core.plugin.entities.plugin import PluginResourceRequirements
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderEntity


class MarketplacePluginDeclaration(BaseModel):
    name: str = Field(..., description="Unique identifier for the plugin within the marketplace")
    org: str = Field(..., description="Organization or developer responsible for creating and maintaining the plugin")
    plugin_id: str = Field(..., description="Globally unique identifier for the plugin across all marketplaces")
    icon: str = Field(..., description="URL or path to the plugin's visual representation")
    label: I18nObject = Field(..., description="Localized display name for the plugin in different languages")
    brief: I18nObject = Field(..., description="Short, localized description of the plugin's functionality")
    resource: PluginResourceRequirements = Field(
        ..., description="Specification of computational resources needed to run the plugin"
    )
    endpoint: EndpointProviderDeclaration | None = Field(
        None, description="Configuration for the plugin's API endpoint, if applicable"
    )
    model: ProviderEntity | None = Field(None, description="Details of the AI model used by the plugin, if any")
    tool: ToolProviderEntity | None = Field(
        None, description="Information about the tool functionality provided by the plugin, if any"
    )
    latest_version: str = Field(
        ..., description="Most recent version number of the plugin available in the marketplace"
    )
    latest_package_identifier: str = Field(
        ..., description="Unique identifier for the latest package release of the plugin"
    )
    status: str = Field(..., description="Indicate the status of marketplace plugin, enum from `active` `deleted`")
    deprecated_reason: str = Field(
        ..., description="Not empty when status='deleted', indicates the reason why this plugin is deleted(deprecated)"
    )
    alternative_plugin_id: str = Field(
        ..., description="Optional, indicates the alternative plugin for user to switch to"
    )

    @model_validator(mode="before")
    @classmethod
    def transform_declaration(cls, data: dict):
        if "endpoint" in data and not data["endpoint"]:
            del data["endpoint"]
        if "model" in data and not data["model"]:
            del data["model"]
        if "tool" in data and not data["tool"]:
            del data["tool"]
        return data
