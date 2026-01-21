import logging
from collections.abc import Mapping
from typing import Any

from core.file import FileTransferMethod
from core.variables.types import SegmentType
from core.variables.variables import FileVariable
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import NodeExecutionType, NodeType
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from factories import file_factory
from factories.variable_factory import build_segment_with_type

from .entities import ContentType, WebhookData

logger = logging.getLogger(__name__)


class TriggerWebhookNode(Node[WebhookData]):
    node_type = NodeType.TRIGGER_WEBHOOK
    execution_type = NodeExecutionType.ROOT

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
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
        system_inputs = self.graph_runtime_state.variable_pool.system_variables.to_dict()

        # TODO: System variables should be directly accessible, no need for special handling
        # Set system variables as node outputs.
        for var in system_inputs:
            outputs[SYSTEM_VARIABLE_NODE_ID + "." + var] = system_inputs[var]
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=webhook_inputs,
            outputs=outputs,
        )

    def generate_file_var(self, param_name: str, file: dict):
        related_id = file.get("related_id")
        transfer_method_value = file.get("transfer_method")
        if transfer_method_value:
            transfer_method = FileTransferMethod.value_of(transfer_method_value)
            match transfer_method:
                case FileTransferMethod.LOCAL_FILE | FileTransferMethod.REMOTE_URL:
                    file["upload_file_id"] = related_id
                case FileTransferMethod.TOOL_FILE:
                    file["tool_file_id"] = related_id
                case FileTransferMethod.DATASOURCE_FILE:
                    file["datasource_file_id"] = related_id

            try:
                file_obj = file_factory.build_from_mapping(
                    mapping=file,
                    tenant_id=self.tenant_id,
                )
                file_segment = build_segment_with_type(SegmentType.FILE, file_obj)
                return FileVariable(name=param_name, value=file_segment.value, selector=[self.id, param_name])
            except ValueError:
                logger.error(
                    "Failed to build FileVariable for webhook file parameter %s",
                    param_name,
                    exc_info=True,
                )
        return None

    def _extract_configured_outputs(self, webhook_inputs: dict[str, Any]) -> dict[str, Any]:
        """Extract outputs based on node configuration from webhook inputs."""
        outputs = {}

        # Get the raw webhook data (should be injected by Celery task)
        webhook_data = webhook_inputs.get("webhook_data", {})

        def _to_sanitized(name: str) -> str:
            return name.replace("-", "_")

        def _get_normalized(mapping: dict[str, Any], key: str) -> Any:
            if not isinstance(mapping, dict):
                return None
            if key in mapping:
                return mapping[key]
            alternate = key.replace("-", "_") if "-" in key else key.replace("_", "-")
            if alternate in mapping:
                return mapping[alternate]
            return None

        # Extract configured headers (case-insensitive)
        webhook_headers = webhook_data.get("headers", {})
        webhook_headers_lower = {k.lower(): v for k, v in webhook_headers.items()}

        for header in self.node_data.headers:
            header_name = header.name
            value = _get_normalized(webhook_headers, header_name)
            if value is None:
                value = _get_normalized(webhook_headers_lower, header_name.lower())
            sanitized_name = _to_sanitized(header_name)
            outputs[sanitized_name] = value

        # Extract configured query parameters
        for param in self.node_data.params:
            param_name = param.name
            outputs[param_name] = webhook_data.get("query_params", {}).get(param_name)

        # Extract configured body parameters
        for body_param in self.node_data.body:
            param_name = body_param.name
            param_type = body_param.type

            if self.node_data.content_type == ContentType.TEXT:
                # For text/plain, the entire body is a single string parameter
                outputs[param_name] = str(webhook_data.get("body", {}).get("raw", ""))
                continue
            elif self.node_data.content_type == ContentType.BINARY:
                raw_data: dict = webhook_data.get("body", {}).get("raw", {})
                file_var = self.generate_file_var(param_name, raw_data)
                if file_var:
                    outputs[param_name] = file_var
                else:
                    outputs[param_name] = raw_data
                continue

            if param_type == "file":
                # Get File object (already processed by webhook controller)
                files = webhook_data.get("files", {})
                if files and isinstance(files, dict):
                    file = files.get(param_name)
                    if file and isinstance(file, dict):
                        file_var = self.generate_file_var(param_name, file)
                        if file_var:
                            outputs[param_name] = file_var
                        else:
                            outputs[param_name] = files
                    else:
                        outputs[param_name] = files
                else:
                    outputs[param_name] = files
            else:
                # Get regular body parameter
                outputs[param_name] = webhook_data.get("body", {}).get(param_name)

        # Include raw webhook data for debugging/advanced use
        outputs["_webhook_raw"] = webhook_data
        return outputs
