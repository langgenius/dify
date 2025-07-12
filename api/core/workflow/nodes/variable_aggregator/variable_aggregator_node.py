from typing import Any

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.variable_aggregator.entities import VariableAssignerNodeData


class VariableAggregatorNodeData(VariableAssignerNodeData):
    aggregate_all: bool = False


class VariableAggregatorNode(BaseNode[VariableAggregatorNodeData]):
    _node_data_cls = VariableAggregatorNodeData
    _node_type = NodeType.VARIABLE_AGGREGATOR

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        # Get variables
        outputs: dict[str, Any] = {}
        inputs: dict[str, Any] = {}

        # if aggregate_all is not configured, aggregate only first variables
        if not getattr(self.node_data, "aggregate_all", False):
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
        else:
            # if aggregate_all is configured, aggregate all variables
            if not self.node_data.advanced_settings or not self.node_data.advanced_settings.group_enabled:
                aggregated_values = []
                for selector in self.node_data.variables:
                    variable = self.graph_runtime_state.variable_pool.get(selector)
                    if variable is not None:
                        aggregated_values.append(variable.to_object())
                        inputs[".".join(selector[1:])] = variable.to_object()

                if aggregated_values:
                    outputs = {"output": aggregated_values}
            else:
                for group in self.node_data.advanced_settings.groups:
                    aggregated_values = []
                    for selector in group.variables:
                        variable = self.graph_runtime_state.variable_pool.get(selector)
                        if variable is not None:
                            aggregated_values.append(variable.to_object())
                            inputs[".".join(selector[1:])] = variable.to_object()

                    if aggregated_values:
                        outputs[group.group_name] = {"output": aggregated_values}

        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs=outputs, inputs=inputs)
