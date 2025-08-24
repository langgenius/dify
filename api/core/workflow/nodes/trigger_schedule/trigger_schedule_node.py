from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Optional

from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.enums import ErrorStrategy, NodeType
from core.workflow.nodes.trigger_schedule.entities import TriggerScheduleNodeData


class TriggerScheduleNode(BaseNode):
    _node_type = NodeType.TRIGGER_SCHEDULE

    _node_data: TriggerScheduleNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = TriggerScheduleNodeData(**data)

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
        node_inputs = dict(self.graph_runtime_state.variable_pool.user_inputs)
        system_inputs = self.graph_runtime_state.variable_pool.system_variables.to_dict()

        # Set system variables as node outputs
        for var in system_inputs:
            node_inputs[SYSTEM_VARIABLE_NODE_ID + "." + var] = system_inputs[var]

        # Add schedule-specific outputs
        triggered_at = datetime.now(UTC)
        node_inputs["triggered_at"] = triggered_at.isoformat()
        node_inputs["timezone"] = self._node_data.timezone
        node_inputs["mode"] = self._node_data.mode
        node_inputs["enabled"] = self._node_data.enabled

        # Add configuration details based on mode
        if self._node_data.mode == "cron" and self._node_data.cron_expression:
            node_inputs["cron_expression"] = self._node_data.cron_expression
        elif self._node_data.mode == "visual":
            node_inputs["frequency"] = self._node_data.frequency or "unknown"
            if self._node_data.visual_config:
                node_inputs["visual_config"] = self._node_data.visual_config

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs=node_inputs,
        )
