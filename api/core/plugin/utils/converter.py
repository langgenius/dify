from typing import Any

from core.tools.entities.tool_entities import ToolSelector
from graphon.file import File


def convert_parameters_to_plugin_format(parameters: dict[str, Any]) -> dict[str, Any]:
    for parameter_name, parameter in parameters.items():
        match parameter:
            case File():
                parameters[parameter_name] = parameter.to_plugin_parameter()
            case [*items] if all(isinstance(p, File) for p in items):
                parameters[parameter_name] = [p.to_plugin_parameter() for p in items]
            case ToolSelector():
                parameters[parameter_name] = parameter.to_plugin_parameter()
            case [*items] if all(isinstance(p, ToolSelector) for p in items):
                parameters[parameter_name] = [p.to_plugin_parameter() for p in items]
    return parameters
