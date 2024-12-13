from typing import Any

from core.file.models import File
from core.tools.entities.tool_entities import ToolSelector


def convert_parameters_to_plugin_format(parameters: dict[str, Any]) -> dict[str, Any]:
    for parameter_name, parameter in parameters.items():
        if isinstance(parameter, File):
            parameters[parameter_name] = parameter.to_plugin_parameter()
        elif isinstance(parameter, list) and all(isinstance(p, File) for p in parameter):
            parameters[parameter_name] = []
            for p in parameter:
                parameters[parameter_name].append(p.to_plugin_parameter())
        elif isinstance(parameter, ToolSelector):
            parameters[parameter_name] = parameter.to_plugin_parameter()
        elif isinstance(parameter, list) and all(isinstance(p, ToolSelector) for p in parameter):
            parameters[parameter_name] = []
            for p in parameter:
                parameters[parameter_name].append(p.to_plugin_parameter())
    return parameters
