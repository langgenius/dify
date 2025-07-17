from collections.abc import Mapping
from typing import Any, Optional

from core.variables.segments import Segment
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.enums import ErrorStrategy, NodeType
from core.workflow.nodes.variable_aggregator.entities import VariableAssignerNodeData


class VariableAggregatorNode(BaseNode):
    _node_type = NodeType.VARIABLE_AGGREGATOR

    node_data: VariableAssignerNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self.node_data = VariableAssignerNodeData(**data)

    def get_error_strategy(self) -> Optional[ErrorStrategy]:
        return self.node_data.error_strategy

    def get_retry_config(self) -> RetryConfig:
        return self.node_data.retry_config

    def get_title(self) -> str:
        return self.node_data.title

    def get_description(self) -> Optional[str]:
        return self.node_data.desc

    def get_default_value_dict(self) -> dict[str, Any]:
        return self.node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self.node_data

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
