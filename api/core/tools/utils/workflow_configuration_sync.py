from collections.abc import Mapping, Sequence
from typing import Any

from core.app.app_config.entities import VariableEntity
from core.tools.entities.tool_entities import WorkflowToolParameterConfiguration
from core.workflow.nodes.base.entities import OutputVariableEntity


class WorkflowToolConfigurationUtils:
    @classmethod
    def check_parameter_configurations(cls, configurations: list[Mapping[str, Any]]):
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
    def get_workflow_graph_output(cls, graph: Mapping[str, Any]) -> Sequence[OutputVariableEntity]:
        """
        get workflow graph output
        """
        nodes = graph.get("nodes", [])
        outputs_by_variable: dict[str, OutputVariableEntity] = {}
        variable_order: list[str] = []

        for node in nodes:
            if node.get("data", {}).get("type") != "end":
                continue

            for output in node.get("data", {}).get("outputs", []):
                entity = OutputVariableEntity.model_validate(output)
                variable = entity.variable

                if variable not in variable_order:
                    variable_order.append(variable)

                # Later end nodes override duplicated variable definitions.
                outputs_by_variable[variable] = entity

        return [outputs_by_variable[variable] for variable in variable_order]

    @classmethod
    def check_is_synced(
        cls, variables: list[VariableEntity], tool_configurations: list[WorkflowToolParameterConfiguration]
    ):
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
