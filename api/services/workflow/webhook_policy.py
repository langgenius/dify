"""Pure webhook admission policy shared by draft and relationship producers."""

from collections.abc import Mapping
from typing import Any

from core.trigger.constants import TRIGGER_WEBHOOK_NODE_TYPE

MAX_WEBHOOK_NODES_PER_WORKFLOW = 5


class WorkflowWebhookLimitError(ValueError):
    """The submitted Workflow exceeds its webhook-node admission limit."""


def validate_webhook_node_count(graph: Mapping[str, Any]) -> None:
    count = sum(1 for node in graph.get("nodes", []) if node["data"]["type"] == TRIGGER_WEBHOOK_NODE_TYPE)
    if count > MAX_WEBHOOK_NODES_PER_WORKFLOW:
        raise WorkflowWebhookLimitError(
            f"Workflow exceeds maximum webhook node limit. Found {count} webhook nodes, "
            f"maximum allowed is {MAX_WEBHOOK_NODES_PER_WORKFLOW}"
        )
