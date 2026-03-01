from collections.abc import Mapping

from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import NodeExecutionType, NodeType
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.trigger_schedule.entities import TriggerScheduleNodeData


class TriggerScheduleNode(Node[TriggerScheduleNodeData]):
    node_type = NodeType.TRIGGER_SCHEDULE
    execution_type = NodeExecutionType.ROOT

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
