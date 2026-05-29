"""
Conditional retry layer for GraphEngine.

This layer evaluates user-defined retry conditions against node failure errors.
When a node fails and has a retry_condition configured, this layer checks whether
the error message matches the condition. If it does not match, retry is disabled
for that node so graphon's ErrorHandler will skip the retry and apply the
configured error strategy instead.
"""

import logging
import re
from typing import Any, Mapping, final, override

from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import GraphEngineEvent, NodeRunFailedEvent
from graphon.graph_events.base import GraphNodeEventBase
from graphon.nodes.base.node import Node

logger = logging.getLogger(__name__)


class RetryConditionOperator:
    CONTAINS = "contains"
    NOT_CONTAINS = "not-contains"
    STARTS_WITH = "starts-with"
    ENDS_WITH = "ends-with"
    EQUALS = "equals"
    NOT_EQUALS = "not-equals"
    REGEX = "regex"


def evaluate_retry_condition(error_message: str, condition: Mapping[str, Any]) -> bool:
    """Evaluate whether an error message matches the retry condition.

    Args:
        error_message: The error message from the failed node execution.
        condition: The retry_condition dict from node config containing
                   'enabled' and 'error_filter' with 'operator' and 'value'.

    Returns:
        True if the error matches the condition (retry should proceed),
        False if it does not match (retry should be skipped).
    """
    if not condition.get("enabled"):
        # Condition not enabled means always retry (no filtering)
        return True

    error_filter = condition.get("error_filter")
    if not error_filter:
        return True

    operator = error_filter.get("operator", RetryConditionOperator.CONTAINS)
    pattern_value = error_filter.get("value", "")

    # Empty pattern means no filtering - always retry
    if not pattern_value:
        return True

    error_lower = error_message.lower()
    pattern_lower = pattern_value.lower()

    match operator:
        case RetryConditionOperator.CONTAINS:
            return pattern_lower in error_lower
        case RetryConditionOperator.NOT_CONTAINS:
            return pattern_lower not in error_lower
        case RetryConditionOperator.STARTS_WITH:
            return error_lower.startswith(pattern_lower)
        case RetryConditionOperator.ENDS_WITH:
            return error_lower.endswith(pattern_lower)
        case RetryConditionOperator.EQUALS:
            return error_lower == pattern_lower
        case RetryConditionOperator.NOT_EQUALS:
            return error_lower != pattern_lower
        case RetryConditionOperator.REGEX:
            try:
                return bool(re.search(pattern_value, error_message))
            except re.error:
                logger.warning(
                    "Invalid regex pattern in retry condition: %s",
                    pattern_value,
                )
                # Invalid regex means condition can't be evaluated; allow retry
                return True
        case _:
            logger.warning("Unknown retry condition operator: %s", operator)
            return True


def _get_retry_condition(node: Node) -> Mapping[str, Any] | None:
    """Extract retry_condition from node data extras.

    The retry_condition is stored as a top-level extra field on BaseNodeData
    (which has extra='allow'), separate from retry_config.
    """
    node_data = getattr(node, "node_data", None)
    if node_data is None:
        return None

    # BaseNodeData has extra="allow", so retry_condition is stored in __pydantic_extra__
    extras = getattr(node_data, "__pydantic_extra__", None)
    if extras and "retry_condition" in extras:
        return extras["retry_condition"]

    # Fallback: try the get() method that BaseNodeData provides
    if hasattr(node_data, "get"):
        condition = node_data.get("retry_condition")
        if condition is not None:
            return condition

    return None


@final
class ConditionalRetryLayer(GraphEngineLayer):
    """Graph layer that evaluates retry conditions against node failure errors.

    When a node fails and has a retry_condition configured, this layer checks
    whether the error message matches the condition. If it does not match,
    retry is disabled for that node execution.
    """

    @override
    def on_graph_start(self) -> None:
        pass

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        _ = event

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        _ = error

    @override
    def on_node_run_end(
        self, node: Node, error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        """Evaluate retry condition when a node fails.

        If the node has retry enabled and a retry_condition configured,
        check whether the error matches the condition. If not, disable
        retry so graphon's ErrorHandler skips the retry attempt.
        """
        if not isinstance(result_event, NodeRunFailedEvent):
            return

        # Only process nodes that have retry enabled
        if not node.retry:
            return

        retry_condition = _get_retry_condition(node)
        if not retry_condition or not retry_condition.get("enabled"):
            return

        error_message = result_event.error or ""
        if not error_message and error is not None:
            error_message = str(error)

        should_retry = evaluate_retry_condition(error_message, retry_condition)

        if not should_retry:
            # Disable retry for this node so ErrorHandler skips retry
            node.node_data.retry_config.retry_enabled = False
            logger.info(
                "Conditional retry: skipping retry for node %s - error '%s' does not match condition",
                node.id,
                error_message[:100],
            )
