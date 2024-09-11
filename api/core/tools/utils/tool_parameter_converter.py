from typing import Any

from core.tools.entities.tool_entities import ToolParameter


class ToolParameterConverter:
    @staticmethod
    def get_parameter_type(parameter_type: str | ToolParameter.ToolParameterType) -> str:
        match parameter_type:
            case (
                ToolParameter.ToolParameterType.STRING
                | ToolParameter.ToolParameterType.SECRET_INPUT
                | ToolParameter.ToolParameterType.SELECT
            ):
                return "string"

            case ToolParameter.ToolParameterType.BOOLEAN:
                return "boolean"

            case ToolParameter.ToolParameterType.NUMBER:
                return "number"

            case _:
                raise ValueError(f"Unsupported parameter type {parameter_type}")

    @staticmethod
    def cast_parameter_by_type(value: Any, parameter_type: str) -> Any:
        # convert tool parameter config to correct type
        try:
            match parameter_type:
                case (
                    ToolParameter.ToolParameterType.STRING
                    | ToolParameter.ToolParameterType.SECRET_INPUT
                    | ToolParameter.ToolParameterType.SELECT
                ):
                    if value is None:
                        return ""
                    else:
                        return value if isinstance(value, str) else str(value)

                case ToolParameter.ToolParameterType.BOOLEAN:
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

                case ToolParameter.ToolParameterType.NUMBER:
                    if isinstance(value, int) | isinstance(value, float):
                        return value
                    elif isinstance(value, str) and value != "":
                        if "." in value:
                            return float(value)
                        else:
                            return int(value)
                case ToolParameter.ToolParameterType.FILE:
                    return value
                case _:
                    return str(value)

        except Exception:
            raise ValueError(f"The tool parameter value {value} is not in correct type of {parameter_type}.")
