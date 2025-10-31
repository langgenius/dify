from collections.abc import Mapping
from typing import Any

from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeType
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.trigger_schedule.entities import TriggerScheduleNodeData


class TriggerScheduleNode(Node):
    node_type = NodeType.TRIGGER_SCHEDULE
    execution_type = NodeExecutionType.ROOT

    _node_data: TriggerScheduleNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = TriggerScheduleNodeData(**data)

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

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        return {
            "type": "trigger-schedule",
            "config": {
                "mode": "visual",
                "frequency": "daily",
                "visual_config": {"time": "12:00 AM", "on_minute": 0, "weekdays": ["sun"], "monthly_days": [1]},
                "timezone": "UTC",
            },
        }

    def _run(self) -> NodeRunResult:
        node_inputs = dict(self.graph_runtime_state.variable_pool.user_inputs)
        system_inputs = self.graph_runtime_state.variable_pool.system_variables.to_dict()

        # TODO: System variables should be directly accessible, no need for special handling
        # Set system variables as node outputs.
        for var in system_inputs:
            node_inputs[SYSTEM_VARIABLE_NODE_ID + "." + var] = system_inputs[var]
        outputs = dict(node_inputs)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=node_inputs,
            outputs=outputs,
        )
