from collections.abc import Mapping
from typing import Any, Optional

from core.plugin.entities.plugin import TriggerProviderID
from core.plugin.utils.http_parser import deserialize_request
from core.trigger.entities.api_entities import TriggerProviderSubscriptionApiEntity
from core.trigger.trigger_manager import TriggerManager
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.enums import ErrorStrategy, NodeType
from extensions.ext_storage import storage
from services.trigger.trigger_provider_service import TriggerProviderService

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

        This node invokes the trigger to convert request data into events
        and makes them available to downstream nodes.
        """

        # Get trigger data passed when workflow was triggered
        trigger_inputs = dict(self.graph_runtime_state.variable_pool.user_inputs)

        request_id = trigger_inputs.get("request_id")
        trigger_name = trigger_inputs.get("trigger_name", "")
        subscription_id = trigger_inputs.get("subscription_id", "")

        if not request_id or not subscription_id:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=trigger_inputs,
                outputs={"error": "No request ID or subscription ID available"},
            )

        try:
            subscription: TriggerProviderSubscriptionApiEntity | None = TriggerProviderService.get_subscription_by_id(
                tenant_id=self.tenant_id, subscription_id=subscription_id
            )
            if not subscription:
                raise ValueError(f"Subscription {subscription_id} not found")

            request = deserialize_request(storage.load_once(f"triggers/{request_id}"))
            parameters = self._node_data.parameters if hasattr(self, "_node_data") and self._node_data else {}
            invoke_response = TriggerManager.invoke_trigger(
                tenant_id=self.tenant_id,
                user_id=self.user_id,
                provider_id=TriggerProviderID(subscription.provider),
                trigger_name=trigger_name,
                parameters=parameters,
                credentials=subscription.credentials,
                credential_type=subscription.credential_type,
                request=request,
            )
            outputs = invoke_response.event.variables or {}
            return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=trigger_inputs, outputs=outputs)
        except Exception as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=trigger_inputs,
                outputs={"error": f"Failed to invoke trigger: {str(e)}", "request_id": request_id},
            )
