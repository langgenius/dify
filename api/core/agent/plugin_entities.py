from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolIdentity, ToolParameter, ToolProviderIdentity


class AgentStrategyProviderIdentity(ToolProviderIdentity):
    pass


class AgentStrategyParameter(ToolParameter):
    pass


class AgentStrategyProviderEntity(BaseModel):
    identity: AgentStrategyProviderIdentity
    plugin_id: Optional[str] = Field(None, description="The id of the plugin")


class AgentStrategyIdentity(ToolIdentity):
    pass


class AgentStrategyEntity(BaseModel):
    identity: AgentStrategyIdentity
    parameters: list[AgentStrategyParameter] = Field(default_factory=list)
    description: I18nObject = Field(..., description="The description of the agent strategy")
    output_schema: Optional[dict] = None

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    @field_validator("parameters", mode="before")
    @classmethod
    def set_parameters(cls, v, validation_info: ValidationInfo) -> list[AgentStrategyParameter]:
        return v or []


class AgentProviderEntityWithPlugin(AgentStrategyProviderEntity):
    strategies: list[AgentStrategyEntity] = Field(default_factory=list)
