from collections.abc import Mapping
from copy import deepcopy
from typing import Any, Optional

from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeType
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node

from .entities import TriggerEventNodeData


class TriggerEventNode(Node):
    node_type = NodeType.TRIGGER_PLUGIN
    execution_type = NodeExecutionType.ROOT

    _node_data: TriggerEventNodeData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = TriggerEventNodeData.model_validate(data)

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
        inputs = deepcopy(self.graph_runtime_state.variable_pool.user_inputs)
        metadata = {
            WorkflowNodeExecutionMetadataKey.TRIGGER_INFO: {
                "provider_id": self._node_data.provider_id,
                "event_name": self._node_data.event_name,
                "plugin_unique_identifier": self._node_data.plugin_unique_identifier,
            },
        }
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={},
            outputs=inputs,
            metadata=metadata,
        )
