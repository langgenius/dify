import enum
from typing import Any, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from core.entities.parameter_entities import CommonParameterType
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolIdentity,
    ToolParameterOption,
    ToolProviderIdentity,
)


class AgentStrategyProviderIdentity(ToolProviderIdentity):
    pass


class AgentStrategyParameter(BaseModel):
    class AgentStrategyParameterType(enum.StrEnum):
        STRING = CommonParameterType.STRING.value
        NUMBER = CommonParameterType.NUMBER.value
        BOOLEAN = CommonParameterType.BOOLEAN.value
        SELECT = CommonParameterType.SELECT.value
        SECRET_INPUT = CommonParameterType.SECRET_INPUT.value
        FILE = CommonParameterType.FILE.value
        FILES = CommonParameterType.FILES.value
        APP_SELECTOR = CommonParameterType.APP_SELECTOR.value
        TOOL_SELECTOR = CommonParameterType.TOOL_SELECTOR.value
        MODEL_SELECTOR = CommonParameterType.MODEL_SELECTOR.value
        TOOLS_SELECTOR = CommonParameterType.TOOLS_SELECTOR.value

        # deprecated, should not use.
        SYSTEM_FILES = CommonParameterType.SYSTEM_FILES.value

        def as_normal_type(self):
            if self in {
                AgentStrategyParameter.AgentStrategyParameterType.SECRET_INPUT,
                AgentStrategyParameter.AgentStrategyParameterType.SELECT,
            }:
                return "string"
            return self.value

        def cast_value(self, value: Any, /):
            try:
                match self:
                    case (
                        AgentStrategyParameter.AgentStrategyParameterType.STRING
                        | AgentStrategyParameter.AgentStrategyParameterType.SECRET_INPUT
                        | AgentStrategyParameter.AgentStrategyParameterType.SELECT
                    ):
                        if value is None:
                            return ""
                        else:
                            return value if isinstance(value, str) else str(value)

                    case AgentStrategyParameter.AgentStrategyParameterType.BOOLEAN:
                        if value is None:
                            return False
                        elif isinstance(value, str):
                            # Allowed YAML boolean value strings: https://yaml.org/type/bool.html
                            # and also '0' for False and '1' for True
                            match value.lower():
                                case "true" | "yes" | "y" | "1":
                                    return True
                                case "false" | "no" | "n" | "0":
                                    return False
                                case _:
                                    return bool(value)
                        else:
                            return value if isinstance(value, bool) else bool(value)

                    case AgentStrategyParameter.AgentStrategyParameterType.NUMBER:
                        if isinstance(value, int | float):
                            return value
                        elif isinstance(value, str) and value:
                            if "." in value:
                                return float(value)
                            else:
                                return int(value)
                    case (
                        AgentStrategyParameter.AgentStrategyParameterType.SYSTEM_FILES
                        | AgentStrategyParameter.AgentStrategyParameterType.FILES
                    ):
                        if not isinstance(value, list):
                            return [value]
                        return value
                    case AgentStrategyParameter.AgentStrategyParameterType.FILE:
                        if isinstance(value, list):
                            if len(value) != 1:
                                raise ValueError(
                                    "This parameter only accepts one file but got multiple files while invoking."
                                )
                            else:
                                return value[0]
                        return value
                    case (
                        AgentStrategyParameter.AgentStrategyParameterType.TOOL_SELECTOR
                        | AgentStrategyParameter.AgentStrategyParameterType.MODEL_SELECTOR
                        | AgentStrategyParameter.AgentStrategyParameterType.APP_SELECTOR
                        | AgentStrategyParameter.AgentStrategyParameterType.TOOLS_SELECTOR
                    ):
                        if not isinstance(value, dict):
                            raise ValueError("The selector must be a dictionary.")
                        return value
                    case _:
                        return str(value)

            except Exception:
                raise ValueError(f"The tool parameter value {value} is not in correct type of {self.as_normal_type()}.")

    name: str = Field(..., description="The name of the parameter")
    label: I18nObject = Field(..., description="The label presented to the user")
    placeholder: Optional[I18nObject] = Field(default=None, description="The placeholder presented to the user")
    type: AgentStrategyParameterType = Field(..., description="The type of the parameter")
    scope: str | None = None
    required: Optional[bool] = False
    default: Optional[Union[float, int, str]] = None
    min: Optional[Union[float, int]] = None
    max: Optional[Union[float, int]] = None
    options: list[ToolParameterOption] = Field(default_factory=list)

    @field_validator("options", mode="before")
    @classmethod
    def transform_options(cls, v):
        if not isinstance(v, list):
            return []
        return v

    @classmethod
    def get_simple_instance(
        cls,
        name: str,
        type: AgentStrategyParameterType,
        required: bool,
        options: Optional[list[str]] = None,
    ):
        """
        get a simple tool parameter

        :param name: the name of the parameter
        :param llm_description: the description presented to the LLM
        :param type: the type of the parameter
        :param required: if the parameter is required
        :param options: the options of the parameter
        """
        # convert options to ToolParameterOption
        if options:
            option_objs = [
                ToolParameterOption(value=option, label=I18nObject(en_US=option, zh_Hans=option)) for option in options
            ]
        else:
            option_objs = []
        return cls(
            name=name,
            label=I18nObject(en_US="", zh_Hans=""),
            placeholder=None,
            type=type,
            required=required,
            options=option_objs,
        )


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
