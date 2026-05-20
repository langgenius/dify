from typing import Any

from core.tools.entities.tool_entities import ToolSelector
from graphon.file import File


def convert_parameters_to_plugin_format(parameters: dict[str, Any]) -> dict[str, Any]:
    for parameter_name, parameter in parameters.items():
        match parameter:
            case File():
                parameters[parameter_name] = parameter.to_plugin_parameter()
            case list() if all(isinstance(p, File) for p in parameter):
                parameters[parameter_name] = [p.to_plugin_parameter() for p in parameter]
            case ToolSelector():
                parameters[parameter_name] = parameter.to_plugin_parameter()
            case list() if all(isinstance(p, ToolSelector) for p in parameter):
                parameters[parameter_name] = [p.to_plugin_parameter() for p in parameter]
    return parameters
