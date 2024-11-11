from collections.abc import Mapping, Sequence
from typing import Any

from core.app.app_config.entities import VariableEntity
from core.tools.entities.tool_entities import WorkflowToolParameterConfiguration


class WorkflowToolConfigurationUtils:
    @classmethod
    def check_parameter_configurations(cls, configurations: Mapping[str, Any]):
        for configuration in configurations:
            WorkflowToolParameterConfiguration.model_validate(configuration)

    @classmethod
    def get_workflow_graph_variables(cls, graph: Mapping[str, Any]) -> Sequence[VariableEntity]:
        """
        get workflow graph variables
        """
        nodes = graph.get("nodes", [])
        start_node = next(filter(lambda x: x.get("data", {}).get("type") == "start", nodes), None)

        if not start_node:
            return []

        return [VariableEntity.model_validate(variable) for variable in start_node.get("data", {}).get("variables", [])]

    @classmethod
    def check_is_synced(
        cls, variables: list[VariableEntity], tool_configurations: list[WorkflowToolParameterConfiguration]
    ) -> None:
        """
        check is synced

        raise ValueError if not synced
        """
        variable_names = [variable.variable for variable in variables]

        if len(tool_configurations) != len(variables):
            raise ValueError("parameter configuration mismatch, please republish the tool to update")

        for parameter in tool_configurations:
            if parameter.name not in variable_names:
                raise ValueError("parameter configuration mismatch, please republish the tool to update")

        return True
