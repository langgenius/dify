from collections.abc import Mapping
from typing import Any, Optional

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.enums import ErrorStrategy, NodeType

from .entities import ContentType, WebhookData


class TriggerWebhookNode(BaseNode):
    _node_type = NodeType.TRIGGER_WEBHOOK

    _node_data: WebhookData

    def init_node_data(self, data: Mapping[str, Any]) -> None:
        self._node_data = WebhookData.model_validate(data)

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
            "type": "webhook",
            "config": {
                "method": "get",
                "content_type": "application/json",
                "headers": [],
                "params": [],
                "body": [],
                "async_mode": True,
                "status_code": 200,
                "response_body": "",
                "timeout": 30,
            },
        }

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        """
        Run the webhook node.

        Like the start node, this simply takes the webhook data from the variable pool
        and makes it available to downstream nodes. The actual webhook handling
        happens in the trigger controller.
        """
        # Get webhook data from variable pool (injected by Celery task)
        webhook_inputs = dict(self.graph_runtime_state.variable_pool.user_inputs)

        # Extract webhook-specific outputs based on node configuration
        outputs = self._extract_configured_outputs(webhook_inputs)

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=webhook_inputs,
            outputs=outputs,
        )

    def _extract_configured_outputs(self, webhook_inputs: dict[str, Any]) -> dict[str, Any]:
        """Extract outputs based on node configuration from webhook inputs."""
        outputs = {}

        # Get the raw webhook data (should be injected by Celery task)
        webhook_data = webhook_inputs.get("webhook_data", {})

        # Extract configured headers (case-insensitive)
        webhook_headers = webhook_data.get("headers", {})
        webhook_headers_lower = {k.lower(): v for k, v in webhook_headers.items()}

        for header in self._node_data.headers:
            header_name = header.name
            # Try exact match first, then case-insensitive match
            value = webhook_headers.get(header_name) or webhook_headers_lower.get(header_name.lower())
            outputs[header_name] = value

        # Extract configured query parameters
        for param in self._node_data.params:
            param_name = param.name
            outputs[param_name] = webhook_data.get("query_params", {}).get(param_name)

        # Extract configured body parameters
        for body_param in self._node_data.body:
            param_name = body_param.name
            param_type = body_param.type

            if self._node_data.content_type == ContentType.TEXT:
                # For text/plain, the entire body is a single string parameter
                outputs[param_name] = str(webhook_data.get("body", {}).get("raw", ""))
                continue

            if param_type == "file":
                # Get File object (already processed by webhook controller)
                file_obj = webhook_data.get("files", {}).get(param_name)
                outputs[param_name] = file_obj
            else:
                # Get regular body parameter
                outputs[param_name] = webhook_data.get("body", {}).get(param_name)

        # Include raw webhook data for debugging/advanced use
        outputs["_webhook_raw"] = webhook_data

        return outputs
