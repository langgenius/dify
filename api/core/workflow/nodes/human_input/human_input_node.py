from collections.abc import Mapping
from typing import Any

from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult, PauseRequestedEvent
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node

from .entities import HumanInputNodeData


class HumanInputNode(Node):
    node_type = NodeType.HUMAN_INPUT
    execution_type = NodeExecutionType.EXECUTABLE

    _node_data: HumanInputNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = HumanInputNodeData(**data)

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    @classmethod
    def version(cls) -> str:
        return "1"

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

    def _run(self):  # type: ignore[override]
        if self._is_completion_ready():
            return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs={})

        return self._pause_generator()

    def _pause_generator(self):
        yield PauseRequestedEvent(reason=self._node_data.pause_reason)

    def _is_completion_ready(self) -> bool:
        """Determine whether all required inputs are satisfied."""

        if not self._node_data.required_variables:
            return False

        variable_pool = self.graph_runtime_state.variable_pool

        for selector_str in self._node_data.required_variables:
            parts = selector_str.split(".")
            if len(parts) != 2:
                return False
            segment = variable_pool.get(parts)
            if segment is None:
                return False

        return True
