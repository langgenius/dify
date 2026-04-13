from collections.abc import Mapping
from typing import Any

from graphon.enums import NodeExecutionType, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node

from core.trigger.constants import TRIGGER_PLUGIN_NODE_TYPE
from core.workflow.variable_prefixes import SYSTEM_VARIABLE_NODE_ID

from .entities import TriggerEventNodeData


class TriggerEventNode(Node[TriggerEventNodeData]):
    node_type = TRIGGER_PLUGIN_NODE_TYPE
    execution_type = NodeExecutionType.ROOT

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        return {
            "type": "plugin",
            "config": {
                "title": "",
                "plugin_id": "",
                "provider_id": "",
                "event_name": "",
                "subscription_id": "",
                "plugin_unique_identifier": "",
                "event_parameters": {},
            },
        }

    @classmethod
    def version(cls) -> str:
        return "1"

    def populate_start_event(self, event) -> None:
        event.provider_id = self.node_data.provider_id

    def _run(self) -> NodeRunResult:
        """
        Run the plugin trigger node.

        This node invokes the trigger to convert request data into events
        and makes them available to downstream nodes.
        """

        # Get trigger data passed when workflow was triggered
        metadata: dict[WorkflowNodeExecutionMetadataKey, Any] = {
            WorkflowNodeExecutionMetadataKey.TRIGGER_INFO: {
                "provider_id": self.node_data.provider_id,
                "event_name": self.node_data.event_name,
                "plugin_unique_identifier": self.node_data.plugin_unique_identifier,
            },
        }
        node_inputs = dict(self.graph_runtime_state.variable_pool.get_by_prefix(self.id))
        system_inputs = self.graph_runtime_state.variable_pool.get_by_prefix(SYSTEM_VARIABLE_NODE_ID)

        for variable_name, value in system_inputs.items():
            node_inputs[f"{SYSTEM_VARIABLE_NODE_ID}.{variable_name}"] = value
        outputs = dict(node_inputs)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=node_inputs,
            outputs=outputs,
            metadata=metadata,
        )
