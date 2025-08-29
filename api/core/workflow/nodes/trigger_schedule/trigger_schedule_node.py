from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Optional

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

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        return {
            "type": "trigger-schedule",
            "config": {
                "mode": "visual",
                "frequency": "weekly",
                "visual_config": {"time": "11:30 AM", "on_minute": 0, "weekdays": ["sun"], "monthly_days": [1]},
                "timezone": "UTC",
            },
        }

    def _run(self) -> NodeRunResult:
        current_time = datetime.now(UTC)
        node_outputs = {"current_time": current_time.isoformat()}

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs=node_outputs,
        )
