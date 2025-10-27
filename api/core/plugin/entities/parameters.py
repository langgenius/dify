import json
from enum import StrEnum, auto
from typing import Any, Union

from pydantic import BaseModel, Field, field_validator

from core.entities.parameter_entities import CommonParameterType
from core.tools.entities.common_entities import I18nObject


class PluginParameterOption(BaseModel):
    value: str = Field(..., description="The value of the option")
    label: I18nObject = Field(..., description="The label of the option")
    icon: str | None = Field(default=None, description="The icon of the option, can be a url or a base64 encoded image")

    @field_validator("value", mode="before")
    @classmethod
    def transform_id_to_str(cls, value) -> str:
        if not isinstance(value, str):
            return str(value)
        else:
            return value


class PluginParameterType(StrEnum):
    """
    all available parameter types
    """

    STRING = CommonParameterType.STRING
    NUMBER = CommonParameterType.NUMBER
    BOOLEAN = CommonParameterType.BOOLEAN
    SELECT = CommonParameterType.SELECT
    SECRET_INPUT = CommonParameterType.SECRET_INPUT
    FILE = CommonParameterType.FILE
    FILES = CommonParameterType.FILES
    APP_SELECTOR = CommonParameterType.APP_SELECTOR
    MODEL_SELECTOR = CommonParameterType.MODEL_SELECTOR
    TOOLS_SELECTOR = CommonParameterType.TOOLS_SELECTOR
    ANY = CommonParameterType.ANY
    DYNAMIC_SELECT = CommonParameterType.DYNAMIC_SELECT

    # deprecated, should not use.
    SYSTEM_FILES = CommonParameterType.SYSTEM_FILES

    # MCP object and array type parameters
    ARRAY = CommonParameterType.ARRAY
    OBJECT = CommonParameterType.OBJECT


class MCPServerParameterType(StrEnum):
    """
    MCP server got complex parameter types
    """

    ARRAY = auto()
    OBJECT = auto()


class PluginParameterAutoGenerate(BaseModel):
    class Type(StrEnum):
        PROMPT_INSTRUCTION = auto()

    type: Type


class PluginParameterTemplate(BaseModel):
    enabled: bool = Field(default=False, description="Whether the parameter is jinja enabled")


class PluginParameter(BaseModel):
    name: str = Field(..., description="The name of the parameter")
    label: I18nObject = Field(..., description="The label presented to the user")
    placeholder: I18nObject | None = Field(default=None, description="The placeholder presented to the user")
    scope: str | None = None
    auto_generate: PluginParameterAutoGenerate | None = None
    template: PluginParameterTemplate | None = None
    required: bool = False
    default: Union[float, int, str, bool] | None = None
    min: Union[float, int] | None = None
    max: Union[float, int] | None = None
    precision: int | None = None
    options: list[PluginParameterOption] = Field(default_factory=list)

    @field_validator("options", mode="before")
    @classmethod
    def transform_options(cls, v):
        if not isinstance(v, list):
            return []
        return v


def as_normal_type(typ: StrEnum):
    if typ.value in {
        PluginParameterType.SECRET_INPUT,
        PluginParameterType.SELECT,
    }:
        return "string"
    return typ.value


def cast_parameter_value(typ: StrEnum, value: Any, /):
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
                if value and not isinstance(value, list):
                    raise ValueError("The tools selector must be a list.")
                return value
            case PluginParameterType.ANY:
                if value and not isinstance(value, str | dict | list | int | float):
                    raise ValueError("The var selector must be a string, dictionary, list or number.")
                return value
            case PluginParameterType.ARRAY:
                if not isinstance(value, list):
                    # Try to parse JSON string for arrays
                    if isinstance(value, str):
                        try:
                            parsed_value = json.loads(value)
                            if isinstance(parsed_value, list):
                                return parsed_value
                        except (json.JSONDecodeError, ValueError):
                            pass
                    return [value]
                return value
            case PluginParameterType.OBJECT:
                if not isinstance(value, dict):
                    # Try to parse JSON string for objects
                    if isinstance(value, str):
                        try:
                            parsed_value = json.loads(value)
                            if isinstance(parsed_value, dict):
                                return parsed_value
                        except (json.JSONDecodeError, ValueError):
                            pass
                    return {}
                return value
            case _:
                return str(value)
    except ValueError:
        raise
    except Exception:
        raise ValueError(f"The tool parameter value {value} is not in correct type of {as_normal_type(typ)}.")


def init_frontend_parameter(rule: PluginParameter, type: StrEnum, value: Any):
    """
    init frontend parameter by rule
    """
    parameter_value = value
    if not parameter_value and parameter_value != 0:
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
