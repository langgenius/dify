from collections.abc import Mapping

from graphon.enums import NodeExecutionType, WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node

from core.trigger.constants import TRIGGER_SCHEDULE_NODE_TYPE
from core.workflow.variable_prefixes import SYSTEM_VARIABLE_NODE_ID

from .entities import TriggerScheduleNodeData


class TriggerScheduleNode(Node[TriggerScheduleNodeData]):
    node_type = TRIGGER_SCHEDULE_NODE_TYPE
    execution_type = NodeExecutionType.ROOT

    @classmethod
    def version(cls) -> str:
        return "1"

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        return {
            "type": TRIGGER_SCHEDULE_NODE_TYPE,
            "config": {
                "mode": "visual",
                "frequency": "daily",
                "visual_config": {"time": "12:00 AM", "on_minute": 0, "weekdays": ["sun"], "monthly_days": [1]},
                "timezone": "UTC",
            },
        }

    def _run(self) -> NodeRunResult:
        node_inputs = dict(self.graph_runtime_state.variable_pool.get_by_prefix(self.id))
        system_inputs = self.graph_runtime_state.variable_pool.get_by_prefix(SYSTEM_VARIABLE_NODE_ID)

        for variable_name, value in system_inputs.items():
            node_inputs[f"{SYSTEM_VARIABLE_NODE_ID}.{variable_name}"] = value
        outputs = dict(node_inputs)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=node_inputs,
            outputs=outputs,
        )
