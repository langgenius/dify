import enum
from typing import Any, Optional, Union

from pydantic import BaseModel, Field, field_validator

from core.entities.parameter_entities import CommonParameterType
from core.tools.entities.common_entities import I18nObject


class PluginParameterOption(BaseModel):
    value: str = Field(..., description="The value of the option")
    label: I18nObject = Field(..., description="The label of the option")

    @field_validator("value", mode="before")
    @classmethod
    def transform_id_to_str(cls, value) -> str:
        if not isinstance(value, str):
            return str(value)
        else:
            return value


class PluginParameterType(enum.StrEnum):
    """
    all available parameter types
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

    # deprecated, should not use.
    SYSTEM_FILES = CommonParameterType.SYSTEM_FILES.value


class PluginParameterAutoGenerate(BaseModel):
    class Type(enum.StrEnum):
        PROMPT_INSTRUCTION = "prompt_instruction"

    type: Type


class PluginParameterTemplate(BaseModel):
    enabled: bool = Field(default=False, description="Whether the parameter is jinja enabled")


class PluginParameter(BaseModel):
    name: str = Field(..., description="The name of the parameter")
    label: I18nObject = Field(..., description="The label presented to the user")
    placeholder: Optional[I18nObject] = Field(default=None, description="The placeholder presented to the user")
    scope: str | None = None
    auto_generate: Optional[PluginParameterAutoGenerate] = None
    template: Optional[PluginParameterTemplate] = None
    required: bool = False
    default: Optional[Union[float, int, str]] = None
    min: Optional[Union[float, int]] = None
    max: Optional[Union[float, int]] = None
    precision: Optional[int] = None
    options: list[PluginParameterOption] = Field(default_factory=list)

    @field_validator("options", mode="before")
    @classmethod
    def transform_options(cls, v):
        if not isinstance(v, list):
            return []
        return v


def as_normal_type(typ: enum.StrEnum):
    if typ.value in {
        PluginParameterType.SECRET_INPUT,
        PluginParameterType.SELECT,
    }:
        return "string"
    return typ.value


def cast_parameter_value(typ: enum.StrEnum, value: Any, /):
    try:
        match typ.value:
            case PluginParameterType.STRING | PluginParameterType.SECRET_INPUT | PluginParameterType.SELECT:
                if value is None:
                    return ""
                else:
                    return value if isinstance(value, str) else str(value)

            case PluginParameterType.BOOLEAN:
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

            case PluginParameterType.NUMBER:
                if isinstance(value, int | float):
                    return value
                elif isinstance(value, str) and value:
                    if "." in value:
                        return float(value)
                    else:
                        return int(value)
            case PluginParameterType.SYSTEM_FILES | PluginParameterType.FILES:
                if not isinstance(value, list):
                    return [value]
                return value
            case PluginParameterType.FILE:
                if isinstance(value, list):
                    if len(value) != 1:
                        raise ValueError("This parameter only accepts one file but got multiple files while invoking.")
                    else:
                        return value[0]
                return value
            case PluginParameterType.MODEL_SELECTOR | PluginParameterType.APP_SELECTOR:
                if not isinstance(value, dict):
                    raise ValueError("The selector must be a dictionary.")
                return value
            case PluginParameterType.TOOLS_SELECTOR:
                if not isinstance(value, list):
                    raise ValueError("The tools selector must be a list.")
                return value
            case _:
                return str(value)
    except ValueError:
        raise
    except Exception:
        raise ValueError(f"The tool parameter value {value} is not in correct type of {as_normal_type(typ)}.")


def init_frontend_parameter(rule: PluginParameter, type: enum.StrEnum, value: Any):
    """
    init frontend parameter by rule
    """
    parameter_value = value
    if not parameter_value and parameter_value != 0 and type != PluginParameterType.TOOLS_SELECTOR:
        # get default value
        parameter_value = rule.default
        if not parameter_value and rule.required:
            raise ValueError(f"tool parameter {rule.name} not found in tool config")

    if type == PluginParameterType.SELECT:
        # check if tool_parameter_config in options
        options = [x.value for x in rule.options]
        if parameter_value is not None and parameter_value not in options:
            raise ValueError(f"tool parameter {rule.name} value {parameter_value} not in options {options}")

    return cast_parameter_value(type, parameter_value)
