from collections.abc import Mapping
from typing import Any

from core.variables.segments import Segment
from core.workflow.enums import ErrorStrategy, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.variable_aggregator.entities import VariableAssignerNodeData


class VariableAggregatorNode(Node):
    node_type = NodeType.VARIABLE_AGGREGATOR

    _node_data: VariableAssignerNodeData

    def init_node_data(self, data: Mapping[str, Any]):
        self._node_data = VariableAssignerNodeData.model_validate(data)

    def _get_error_strategy(self) -> ErrorStrategy | None:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> str | None:
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        # Get variables
        outputs: dict[str, Segment | Mapping[str, Segment]] = {}
        inputs = {}

        if not self._node_data.advanced_settings or not self._node_data.advanced_settings.group_enabled:
            for selector in self._node_data.variables:
                variable = self.graph_runtime_state.variable_pool.get(selector)
                if variable is not None:
                    outputs = {"output": variable}

                    inputs = {".".join(selector[1:]): variable.to_object()}
                    break
        else:
            for group in self._node_data.advanced_settings.groups:
                for selector in group.variables:
                    variable = self.graph_runtime_state.variable_pool.get(selector)

                    if variable is not None:
                        outputs[group.group_name] = {"output": variable}
                        inputs[".".join(selector[1:])] = variable.to_object()
                        break

        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs=outputs, inputs=inputs)
