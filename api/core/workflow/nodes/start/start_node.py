from typing import cast

from core.app.app_config.entities import VariableEntity
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType, SystemVariable
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.start.entities import StartNodeData
from models.workflow import WorkflowNodeExecutionStatus


class StartNode(BaseNode):
    _node_data_cls = StartNodeData
    node_type = NodeType.START

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run node
        :param variable_pool: variable pool
        :return:
        """
        node_data = self.node_data
        node_data = cast(self._node_data_cls, node_data)
        variables = node_data.variables

        # Get cleaned inputs
        cleaned_inputs = self._get_cleaned_inputs(variables, variable_pool.user_inputs)

        for var in variable_pool.system_variables:
            if var == SystemVariable.CONVERSATION:
                continue

            cleaned_inputs['sys.' + var.value] = variable_pool.system_variables[var]

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=cleaned_inputs,
            outputs=cleaned_inputs
        )

    def _get_cleaned_inputs(self, variables: list[VariableEntity], user_inputs: dict):
        if user_inputs is None:
            user_inputs = {}

        filtered_inputs = {}

        for variable_config in variables:
            variable = variable_config.variable

            if variable not in user_inputs or not user_inputs[variable]:
                if variable_config.required:
                    raise ValueError(f"Input form variable {variable} is required")
                else:
                    filtered_inputs[variable] = variable_config.default if variable_config.default is not None else ""
                    continue

            value = user_inputs[variable]

            if value:
                if not isinstance(value, str):
                    raise ValueError(f"{variable} in input form must be a string")

            if variable_config.type == VariableEntity.Type.SELECT:
                options = variable_config.options if variable_config.options is not None else []
                if value not in options:
                    raise ValueError(f"{variable} in input form must be one of the following: {options}")
            else:
                if variable_config.max_length is not None:
                    max_length = variable_config.max_length
                    if len(value) > max_length:
                        raise ValueError(f'{variable} in input form must be less than {max_length} characters')

            filtered_inputs[variable] = value.replace('\x00', '') if value else None

        return filtered_inputs

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        return {}
