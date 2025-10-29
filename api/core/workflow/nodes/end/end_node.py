from collections.abc import Mapping
from typing import Any

from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.template import Template
from core.workflow.nodes.end.entities import EndNodeData


class EndNode(Node):
    node_type = NodeType.END
    execution_type = NodeExecutionType.RESPONSE

    _node_data: EndNodeData

    def init_node_data(self, data: Mapping[str, Any]):
        self._node_data = EndNodeData.model_validate(data)

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
        """
        Run node - collect all outputs at once.

        This method runs after streaming is complete (if streaming was enabled).
        It collects all output variables and returns them.
        """
        output_variables = self._node_data.outputs

        outputs = {}
        for variable_selector in output_variables:
            variable = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
            value = variable.to_object() if variable is not None else None
            outputs[variable_selector.variable] = value

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=outputs,
            outputs=outputs,
        )

    def get_streaming_template(self) -> Template:
        """
        Get the template for streaming.

        Returns:
            Template instance for this End node
        """
        outputs_config = [
            {"variable": output.variable, "value_selector": output.value_selector} for output in self._node_data.outputs
        ]
        return Template.from_end_outputs(outputs_config)
