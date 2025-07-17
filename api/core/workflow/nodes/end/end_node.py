from collections.abc import Mapping
from typing import Any, Optional

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.enums import ErrorStrategy, NodeType


class EndNode(BaseNode):
    _node_type = NodeType.END

    node_data: EndNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self.node_data = EndNodeData(**data)

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
        """
        Run node
        :return:
        """
        output_variables = self.node_data.outputs

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
