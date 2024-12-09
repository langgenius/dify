from typing import Optional
from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolIdentity, ToolParameter, ToolProviderIdentity


class AgentProviderIdentity(ToolProviderIdentity):
    pass


class AgentParameter(ToolParameter):
    pass


class AgentProviderEntity(BaseModel):
    identity: AgentProviderIdentity
    plugin_id: Optional[str] = Field(None, description="The id of the plugin")


class AgentIdentity(ToolIdentity):
    pass


class AgentStrategyEntity(BaseModel):
    identity: AgentIdentity
    parameters: list[AgentParameter] = Field(default_factory=list)
    description: I18nObject = Field(..., description="The description of the agent strategy")
    output_schema: Optional[dict] = None

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    @field_validator("parameters", mode="before")
    @classmethod
    def set_parameters(cls, v, validation_info: ValidationInfo) -> list[AgentParameter]:
        return v or []


class AgentProviderEntityWithPlugin(AgentProviderEntity):
    strategies: list[AgentStrategyEntity] = Field(default_factory=list)
