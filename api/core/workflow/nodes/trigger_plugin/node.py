from collections.abc import Mapping
from typing import Any, Optional

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.enums import ErrorStrategy, NodeType

from .entities import PluginTriggerData


class TriggerPluginNode(BaseNode):
    _node_type = NodeType.TRIGGER_PLUGIN

    _node_data: PluginTriggerData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = PluginTriggerData.model_validate(data)

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
    def get_default_config(cls, filters: Optional[dict[str, Any]] = None) -> dict:
        return {
            "type": "plugin",
            "config": {
                "plugin_id": "",
                "provider_id": "",
                "trigger_name": "",
                "subscription_id": "",
                "parameters": {},
            },
        }

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        """
        Run the plugin trigger node.

        Like the webhook node, this takes the trigger data from the variable pool
        and makes it available to downstream nodes. The actual trigger invocation
        happens in the async task executor.
        """
        # Get trigger data from variable pool (injected by async task)
        trigger_inputs = dict(self.graph_runtime_state.variable_pool.user_inputs)

        # Extract trigger-specific outputs
        outputs = self._extract_trigger_outputs(trigger_inputs)

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=trigger_inputs,
            outputs=outputs,
        )

    def _extract_trigger_outputs(self, trigger_inputs: dict[str, Any]) -> dict[str, Any]:
        """Extract outputs from trigger invocation response."""
        outputs = {}

        # Get the trigger data (should be injected by async task)
        trigger_data = trigger_inputs.get("trigger_data", {})
        trigger_metadata = trigger_inputs.get("trigger_metadata", {})

        # Make trigger data available as outputs
        outputs["data"] = trigger_data
        outputs["trigger_name"] = trigger_metadata.get("trigger_name", "")
        outputs["provider_id"] = trigger_metadata.get("provider_id", "")
        outputs["subscription_id"] = self._node_data.subscription_id

        # Include raw trigger data for debugging/advanced use
        outputs["_trigger_raw"] = {
            "data": trigger_data,
            "metadata": trigger_metadata,
        }

        return outputs
