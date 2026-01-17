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
    NodeType,
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
    from core.workflow.runtime import GraphRuntimeState

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

    def __init__(
        self,
        graph: Graph,
        graph_execution: "GraphExecution",
        graph_runtime_state: "GraphRuntimeState | None" = None,
    ) -> None:
        """
        Initialize the error handler.

        Args:
            graph: The workflow graph
            graph_execution: The graph execution state
            graph_runtime_state: The graph runtime state (optional, for fallback model support)
        """
        self._graph = graph
        self._graph_execution = graph_execution
        self._graph_runtime_state = graph_runtime_state

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
            case ErrorStrategyEnum.FALLBACK_MODEL:
                return self._handle_fallback_model(event)

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

    def _handle_fallback_model(self, event: NodeRunFailedEvent):
        """
        Handle error by trying fallback models.

        This strategy attempts to retry the LLM node with alternative models
        from the configured fallback_models list when the primary model fails.

        Args:
            event: The failure event

        Returns:
            NodeRunRetryEvent if a fallback model is available, None otherwise
        """
        node = self._graph.nodes[event.node_id]

        # Only support fallback model for LLM nodes
        if node.node_type != NodeType.LLM:
            logger.warning(
                "Fallback model strategy is only supported for LLM nodes, node %s is %s", event.node_id, node.node_type
            )
            return self._handle_abort(event)

        # Check if node has fallback_models configured
        if not hasattr(node.node_data, "fallback_models") or not node.node_data.fallback_models:
            logger.warning("Node %s has fallback model strategy but no fallback_models configured", event.node_id)
            return self._handle_abort(event)

        fallback_models = node.node_data.fallback_models

        # Get the last attempted model index from metadata or variable pool
        # -1 means primary model, 0+ means fallback model index
        last_model_index = event.node_run_result.metadata.get(WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX, -1)

        # Also check variable pool as a fallback (more reliable)
        # This handles the case where metadata might not be preserved in the failure event
        # When a fallback model fails, the variable pool still contains the index of the model that was tried
        if self._graph_runtime_state is not None:
            fallback_index_var = self._graph_runtime_state.variable_pool.get((event.node_id, "_fallback_model_index"))
            if fallback_index_var is not None:
                try:
                    # Get the value from the segment
                    fallback_index_str = (
                        fallback_index_var.text
                        if hasattr(fallback_index_var, "text")
                        else str(fallback_index_var.value)
                    )
                    pool_index = int(fallback_index_str)
                    # Use the higher index to ensure we don't go backwards
                    # This ensures we track the highest model index that has been attempted
                    last_model_index = max(last_model_index, pool_index)
                    logger.debug(
                        "Found fallback model index %d in variable pool for node %s (metadata had %d)",
                        pool_index,
                        event.node_id,
                        event.node_run_result.metadata.get(WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX, -1),
                    )
                except (ValueError, AttributeError) as e:
                    logger.warning(
                        "Failed to parse fallback model index from variable pool for node %s: %s",
                        event.node_id,
                        e,
                    )

        # Calculate next model index
        next_model_index = last_model_index + 1

        # Check if we have more fallback models to try
        if next_model_index >= len(fallback_models):
            logger.warning(
                "All fallback models exhausted for node %s (tried %d models: primary + %d fallback models)",
                event.node_id,
                len(fallback_models) + 1,
                len(fallback_models),
            )
            # Clear the fallback model index from variable pool to prevent confusion
            if self._graph_runtime_state is not None:
                self._graph_runtime_state.variable_pool.remove((event.node_id, "_fallback_model_index"))
            # Return None to abort execution
            return self._handle_abort(event)

        # Get the next fallback model
        next_model = fallback_models[next_model_index]

        logger.info(
            "Retrying node %s with fallback model %d: %s/%s",
            event.node_id,
            next_model_index,
            next_model.provider,
            next_model.name,
        )

        # Store fallback model index in variable pool so LLM node can access it
        # variable_pool.add() will automatically convert the string to a Segment
        if self._graph_runtime_state is not None:
            variable_pool = self._graph_runtime_state.variable_pool
            variable_pool.add((event.node_id, "_fallback_model_index"), str(next_model_index))
        else:
            logger.warning(
                "graph_runtime_state not available, cannot store fallback model index in variable pool for node %s",
                event.node_id,
            )

        # Create retry event with metadata indicating which fallback model to use
        metadata = event.node_run_result.metadata.copy() if event.node_run_result.metadata else {}
        metadata[WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX] = next_model_index
        metadata[WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY] = ErrorStrategyEnum.FALLBACK_MODEL

        return NodeRunRetryEvent(
            id=event.id,
            node_title=node.title,
            node_id=event.node_id,
            node_type=event.node_type,
            node_run_result=NodeRunResult(
                status=event.node_run_result.status,
                inputs=event.node_run_result.inputs,
                process_data=event.node_run_result.process_data,
                outputs=event.node_run_result.outputs,
                metadata=metadata,
                error=event.error,
                error_type=event.node_run_result.error_type,
                llm_usage=event.node_run_result.llm_usage,
            ),
            start_at=event.start_at,
            error=event.error,
            retry_index=0,  # This is not a regular retry, so we use 0
        )
