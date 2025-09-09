"""
Main error handler that coordinates error strategies.
"""

import logging
import time
from typing import TYPE_CHECKING, final

from core.workflow.enums import (
    ErrorStrategy as ErrorStrategyEnum,
)
from core.workflow.enums import (
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.graph import Graph
from core.workflow.graph_events import (
    GraphNodeEventBase,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunRetryEvent,
)
from core.workflow.node_events import NodeRunResult

if TYPE_CHECKING:
    from .domain import GraphExecution

logger = logging.getLogger(__name__)


@final
class ErrorHandler:
    """
    Coordinates error handling strategies for node failures.

    This acts as a facade for the various error strategies,
    selecting and applying the appropriate strategy based on
    node configuration.
    """

    def __init__(self, graph: Graph, graph_execution: "GraphExecution") -> None:
        """
        Initialize the error handler.

        Args:
            graph: The workflow graph
            graph_execution: The graph execution state
        """
        self._graph = graph
        self._graph_execution = graph_execution

    def handle_node_failure(self, event: NodeRunFailedEvent) -> GraphNodeEventBase | None:
        """
        Handle a node failure event.

        Selects and applies the appropriate error strategy based on
        the node's configuration.

        Args:
            event: The node failure event

        Returns:
            Optional new event to process, or None to abort
        """
        node = self._graph.nodes[event.node_id]
        # Get retry count from NodeExecution
        node_execution = self._graph_execution.get_or_create_node_execution(event.node_id)
        retry_count = node_execution.retry_count

        # First check if retry is configured and not exhausted
        if node.retry and retry_count < node.retry_config.max_retries:
            result = self._handle_retry(event, retry_count)
            if result:
                # Retry count will be incremented when NodeRunRetryEvent is handled
                return result

        # Apply configured error strategy
        strategy = node.error_strategy

        match strategy:
            case None:
                return self._handle_abort(event)
            case ErrorStrategyEnum.FAIL_BRANCH:
                return self._handle_fail_branch(event)
            case ErrorStrategyEnum.DEFAULT_VALUE:
                return self._handle_default_value(event)

    def _handle_abort(self, event: NodeRunFailedEvent):
        """
        Handle error by aborting execution.

        This is the default strategy when no other strategy is specified.
        It stops the entire graph execution when a node fails.

        Args:
            event: The failure event

        Returns:
            None - signals abortion
        """
        logger.error("Node %s failed with ABORT strategy: %s", event.node_id, event.error)
        # Return None to signal that execution should stop

    def _handle_retry(self, event: NodeRunFailedEvent, retry_count: int):
        """
        Handle error by retrying the node.

        This strategy re-attempts node execution up to a configured
        maximum number of retries with configurable intervals.

        Args:
            event: The failure event
            retry_count: Current retry attempt count

        Returns:
            NodeRunRetryEvent if retry should occur, None otherwise
        """
        node = self._graph.nodes[event.node_id]

        # Check if we've exceeded max retries
        if not node.retry or retry_count >= node.retry_config.max_retries:
            return None

        # Wait for retry interval
        time.sleep(node.retry_config.retry_interval_seconds)

        # Create retry event
        return NodeRunRetryEvent(
            id=event.id,
            node_title=node.title,
            node_id=event.node_id,
            node_type=event.node_type,
            node_run_result=event.node_run_result,
            start_at=event.start_at,
            error=event.error,
            retry_index=retry_count + 1,
        )

    def _handle_fail_branch(self, event: NodeRunFailedEvent):
        """
        Handle error by taking the fail branch.

        This strategy converts failures to exceptions and routes execution
        through a designated fail-branch edge.

        Args:
            event: The failure event

        Returns:
            NodeRunExceptionEvent to continue via fail branch
        """
        outputs = {
            "error_message": event.node_run_result.error,
            "error_type": event.node_run_result.error_type,
        }

        return NodeRunExceptionEvent(
            id=event.id,
            node_id=event.node_id,
            node_type=event.node_type,
            start_at=event.start_at,
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.EXCEPTION,
                inputs=event.node_run_result.inputs,
                process_data=event.node_run_result.process_data,
                outputs=outputs,
                edge_source_handle="fail-branch",
                metadata={
                    WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: ErrorStrategyEnum.FAIL_BRANCH,
                },
            ),
            error=event.error,
        )

    def _handle_default_value(self, event: NodeRunFailedEvent):
        """
        Handle error by using default values.

        This strategy allows nodes to fail gracefully by providing
        predefined default output values.

        Args:
            event: The failure event

        Returns:
            NodeRunExceptionEvent with default values
        """
        node = self._graph.nodes[event.node_id]

        outputs = {
            **node.default_value_dict,
            "error_message": event.node_run_result.error,
            "error_type": event.node_run_result.error_type,
        }

        return NodeRunExceptionEvent(
            id=event.id,
            node_id=event.node_id,
            node_type=event.node_type,
            start_at=event.start_at,
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.EXCEPTION,
                inputs=event.node_run_result.inputs,
                process_data=event.node_run_result.process_data,
                outputs=outputs,
                metadata={
                    WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: ErrorStrategyEnum.DEFAULT_VALUE,
                },
            ),
            error=event.error,
        )
