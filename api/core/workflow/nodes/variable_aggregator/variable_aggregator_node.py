from collections.abc import Mapping

from core.variables.segments import Segment
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.variable_aggregator.entities import VariableAssignerNodeData


class VariableAggregatorNode(BaseNode[VariableAssignerNodeData]):
    _node_data_cls = VariableAssignerNodeData
    _node_type = NodeType.VARIABLE_AGGREGATOR

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        # Get variables
        outputs: dict[str, Segment | Mapping[str, Segment]] = {}
        inputs = {}

        if not self.node_data.advanced_settings or not self.node_data.advanced_settings.group_enabled:
            for selector in self.node_data.variables:
                variable = self.graph_runtime_state.variable_pool.get(selector)
                if variable is not None:
                    outputs = {"output": variable}

                    inputs = {".".join(selector[1:]): variable.to_object()}
                    break
        else:
            for group in self.node_data.advanced_settings.groups:
                for selector in group.variables:
                    variable = self.graph_runtime_state.variable_pool.get(selector)

                    if variable is not None:
                        outputs[group.group_name] = {"output": variable}
                        inputs[".".join(selector[1:])] = variable.to_object()
                        break

        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs=outputs, inputs=inputs)
