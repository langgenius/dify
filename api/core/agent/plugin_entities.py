import enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from core.entities.parameter_entities import CommonParameterType
from core.plugin.entities.parameters import (
    PluginParameter,
    as_normal_type,
    cast_parameter_value,
    init_frontend_parameter,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolIdentity,
    ToolProviderIdentity,
)


class AgentStrategyProviderIdentity(ToolProviderIdentity):
    """
    Inherits from ToolProviderIdentity, without any additional fields.
    """

    pass


class AgentStrategyParameter(PluginParameter):
    class AgentStrategyParameterType(enum.StrEnum):
        """
        Keep all the types from PluginParameterType
        """

        STRING = CommonParameterType.STRING.value
        NUMBER = CommonParameterType.NUMBER.value
        BOOLEAN = CommonParameterType.BOOLEAN.value
        SELECT = CommonParameterType.SELECT.value
        SECRET_INPUT = CommonParameterType.SECRET_INPUT.value
        FILE = CommonParameterType.FILE.value
        FILES = CommonParameterType.FILES.value
        APP_SELECTOR = CommonParameterType.APP_SELECTOR.value
        MODEL_SELECTOR = CommonParameterType.MODEL_SELECTOR.value
        TOOLS_SELECTOR = CommonParameterType.TOOLS_SELECTOR.value
        ANY = CommonParameterType.ANY.value

        # deprecated, should not use.
        SYSTEM_FILES = CommonParameterType.SYSTEM_FILES.value

        def as_normal_type(self):
            return as_normal_type(self)

        def cast_value(self, value: Any):
            return cast_parameter_value(self, value)

    type: AgentStrategyParameterType = Field(..., description="The type of the parameter")
    help: Optional[I18nObject] = None

    def init_frontend_parameter(self, value: Any):
        return init_frontend_parameter(self, self.type, value)


class AgentStrategyProviderEntity(BaseModel):
    identity: AgentStrategyProviderIdentity
    plugin_id: Optional[str] = Field(None, description="The id of the plugin")


class AgentStrategyIdentity(ToolIdentity):
    """
    Inherits from ToolIdentity, without any additional fields.
    """

    pass


class AgentFeature(enum.StrEnum):
    """
    Agent Feature, used to describe the features of the agent strategy.
    """

    HISTORY_MESSAGES = "history-messages"


class AgentStrategyEntity(BaseModel):
    identity: AgentStrategyIdentity
    parameters: list[AgentStrategyParameter] = Field(default_factory=list)
    description: I18nObject = Field(..., description="The description of the agent strategy")
    output_schema: Optional[dict] = None
    features: Optional[list[AgentFeature]] = None
    meta_version: Optional[str] = None
    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    @field_validator("parameters", mode="before")
    @classmethod
    def set_parameters(cls, v, validation_info: ValidationInfo) -> list[AgentStrategyParameter]:
        return v or []


class AgentProviderEntityWithPlugin(AgentStrategyProviderEntity):
    strategies: list[AgentStrategyEntity] = Field(default_factory=list)
