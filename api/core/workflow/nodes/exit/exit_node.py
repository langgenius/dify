from collections.abc import Mapping
from typing import Any, Optional

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.enums import ErrorStrategy, NodeType
from core.workflow.nodes.exit.entities import ExitNodeData
from core.workflow.nodes.exit.exceptions import WorkflowExitException


class ExitNode(BaseNode):
    _node_type = NodeType.EXIT

    _node_data: ExitNodeData

    def init_node_data(self, data: Mapping[str, Any]):
        self._node_data = ExitNodeData(**data)

    def _get_error_strategy(self) -> Optional[ErrorStrategy]:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> Optional[str]:
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
        Run node - this will terminate the workflow execution early
        by raising a WorkflowExitException.
        """
        output_variables = self._node_data.outputs

        outputs = {}
        for variable_selector in output_variables:
            variable = self.graph_runtime_state.variable_pool.get(
                variable_selector.value_selector
            )
            value = variable.to_object() if variable is not None else None
            outputs[variable_selector.variable] = value

        # Raise the exit exception to terminate workflow execution
        raise WorkflowExitException(
            outputs=outputs,
        ) 