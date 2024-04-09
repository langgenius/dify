from typing import cast

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.variable_assigner.entities import VariableAssignerNodeData
from models.workflow import WorkflowNodeExecutionStatus


class VariableAssignerNode(BaseNode):
    _node_data_cls = VariableAssignerNodeData
    _node_type = NodeType.VARIABLE_ASSIGNER

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        node_data: VariableAssignerNodeData = cast(self._node_data_cls, self.node_data)
        # Get variables
        outputs = {}
        inputs = {}
        for variable in node_data.variables:
            value = variable_pool.get_variable_value(variable)

            if value is not None:
                outputs = {
                    "output": value
                }

                inputs = {
                    '.'.join(variable[1:]): value
                }
                break

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs=outputs,
            inputs=inputs
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        return {}
