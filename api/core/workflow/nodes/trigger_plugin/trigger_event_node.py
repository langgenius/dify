from collections.abc import Mapping

from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.enums import NodeExecutionType, NodeType
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node

from .entities import TriggerEventNodeData


class TriggerEventNode(Node[TriggerEventNodeData]):
    node_type = NodeType.TRIGGER_PLUGIN
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

    def _run(self) -> NodeRunResult:
        """
        Run the plugin trigger node.

        This node invokes the trigger to convert request data into events
        and makes them available to downstream nodes.
        """

        # Get trigger data passed when workflow was triggered
        metadata = {
            WorkflowNodeExecutionMetadataKey.TRIGGER_INFO: {
                "provider_id": self.node_data.provider_id,
                "event_name": self.node_data.event_name,
                "plugin_unique_identifier": self.node_data.plugin_unique_identifier,
            },
        }
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
            metadata=metadata,
        )
