"""Node failure strategy selection."""

import logging
import time
from typing import assert_never, final

from graphon.engine_events.base import NodeEvent
from graphon.engine_events.node import (
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunRetryEvent,
)
from graphon.enums import (
    ErrorStrategy,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.graph.graph import Graph
from graphon.node_events.base import NodeRunResult
from graphon.runtime.execution import GraphExecution

logger = logging.getLogger(__name__)


@final
class NodeFailureHandler:
    """Select the configured continuation for a failed node.

    A retry or configured error strategy becomes another node event. Returning
    ``None`` tells the processor that the failure aborts its execution scope.
    """

    def __init__(
        self,
        graph: Graph,
        graph_execution: GraphExecution,
    ) -> None:
        """Initialize failure handling for one frame's graph.

        Args:
            graph: The workflow graph
            graph_execution: The graph execution state

        """
        self._graph = graph
        self._graph_execution = graph_execution

    def handle(
        self,
        *,
        frame_id: str,
        event: NodeRunFailedEvent,
    ) -> NodeEvent | None:
        """Translate a failed node event into its configured continuation.

        Retry eligibility is checked once here before the configured terminal
        strategy is considered. The returned event is fed back into the node
        event processor; ``None`` means no continuation exists and execution
        should fail at the current scope.

        Args:
            frame_id: Frame containing the failed node execution.
            event: Failed node event to resolve.

        Returns:
            Retry or exception event to process, or ``None`` to abort.

        """
        node = self._graph.nodes[event.node_id]
        # Get retry count from NodeExecution
        node_execution = self._graph_execution.get_or_create_node_execution(
            frame_id=frame_id,
            node_id=event.node_id,
        )
        retry_count = node_execution.retry_count

        if node.retry and retry_count < node.retry_config.max_retries:
            # Retry count is incremented when NodeRunRetryEvent is processed.
            return self._handle_retry(event, retry_count)

        # Apply configured error strategy
        strategy = node.error_strategy

        match strategy:
            case None:
                logger.error(
                    "Node %s failed without a continuation strategy: %s",
                    event.node_id,
                    event.error,
                )
                return None
            case ErrorStrategy.FAIL_BRANCH:
                return self._handle_fail_branch(event)
            case ErrorStrategy.DEFAULT_VALUE:
                return self._handle_default_value(event)
            case _:
                assert_never(strategy)

    def _handle_retry(
        self,
        event: NodeRunFailedEvent,
        retry_count: int,
    ) -> NodeRunRetryEvent:
        """Handle error by retrying the node.

        Eligibility has already been established by :meth:`handle`; this helper
        waits for the configured interval and builds the retry event.

        Args:
            event: The failure event
            retry_count: Current retry attempt count

        Returns:
            Event requesting the next node attempt.

        """
        node = self._graph.nodes[event.node_id]

        time.sleep(node.retry_config.retry_interval_seconds)
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

    def _handle_fail_branch(self, event: NodeRunFailedEvent) -> NodeRunExceptionEvent:
        """Handle error by taking the fail branch.

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
            finished_at=event.finished_at,
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.EXCEPTION,
                inputs=event.node_run_result.inputs,
                process_data=event.node_run_result.process_data,
                outputs=outputs,
                edge_source_handle="fail-branch",
                metadata={
                    WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: (
                        ErrorStrategy.FAIL_BRANCH
                    ),
                },
            ),
            error=event.error,
        )

    def _handle_default_value(self, event: NodeRunFailedEvent) -> NodeRunExceptionEvent:
        """Handle error by using default values.

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
            finished_at=event.finished_at,
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.EXCEPTION,
                inputs=event.node_run_result.inputs,
                process_data=event.node_run_result.process_data,
                outputs=outputs,
                metadata={
                    WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: (
                        ErrorStrategy.DEFAULT_VALUE
                    ),
                },
            ),
            error=event.error,
        )
