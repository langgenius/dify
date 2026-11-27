from collections.abc import Mapping
from typing import override

from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.node_events.base import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.nodes.variable_aggregator.entities import VariableAggregatorNodeData
from graphon.variables.segments import Segment


class VariableAggregatorNode(Node[VariableAggregatorNodeData]):
    node_type = BuiltinNodeTypes.VARIABLE_AGGREGATOR

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        # Get variables
        outputs: dict[str, Segment | Mapping[str, Segment]] = {}
        inputs = {}

        if (
            not self.node_data.advanced_settings
            or not self.node_data.advanced_settings.group_enabled
        ):
            for selector in self.node_data.variables:
                variable = self.runtime_state.variable_pool.get(selector)
                if variable is not None:
                    outputs = {"output": variable}

                    inputs = {".".join(selector[1:]): variable.to_object()}
                    break
        else:
            for group in self.node_data.advanced_settings.groups:
                for selector in group.variables:
                    variable = self.runtime_state.variable_pool.get(selector)

                    if variable is not None:
                        outputs[group.group_name] = {"output": variable}
                        inputs[".".join(selector[1:])] = variable.to_object()
                        break

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs=outputs,
            inputs=inputs,
        )
