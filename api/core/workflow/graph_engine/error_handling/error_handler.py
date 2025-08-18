"""
Main error handler that coordinates error strategies.
"""

from typing import TYPE_CHECKING, Optional

from core.workflow.enums import ErrorStrategy as ErrorStrategyEnum
from core.workflow.graph import Graph
from core.workflow.graph_events import GraphNodeEventBase, NodeRunFailedEvent

from .abort_strategy import AbortStrategy
from .default_value_strategy import DefaultValueStrategy
from .fail_branch_strategy import FailBranchStrategy
from .retry_strategy import RetryStrategy

if TYPE_CHECKING:
    from ..domain import GraphExecution


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
        self.graph = graph
        self.graph_execution = graph_execution

        # Initialize strategies
        self.abort_strategy = AbortStrategy()
        self.retry_strategy = RetryStrategy()
        self.fail_branch_strategy = FailBranchStrategy()
        self.default_value_strategy = DefaultValueStrategy()

    def handle_node_failure(self, event: NodeRunFailedEvent) -> Optional[GraphNodeEventBase]:
        """
        Handle a node failure event.

        Selects and applies the appropriate error strategy based on
        the node's configuration.

        Args:
            event: The node failure event

        Returns:
            Optional new event to process, or None to abort
        """
        node = self.graph.nodes[event.node_id]
        # Get retry count from NodeExecution
        node_execution = self.graph_execution.get_or_create_node_execution(event.node_id)
        retry_count = node_execution.retry_count

        # First check if retry is configured and not exhausted
        if node.retry and retry_count < node.retry_config.max_retries:
            result = self.retry_strategy.handle_error(event, self.graph, retry_count)
            if result:
                # Retry count will be incremented when NodeRunRetryEvent is handled
                return result

        # Apply configured error strategy
        strategy = node.error_strategy

        if strategy is None:
            return self.abort_strategy.handle_error(event, self.graph, retry_count)
        elif strategy == ErrorStrategyEnum.FAIL_BRANCH:
            return self.fail_branch_strategy.handle_error(event, self.graph, retry_count)
        elif strategy == ErrorStrategyEnum.DEFAULT_VALUE:
            return self.default_value_strategy.handle_error(event, self.graph, retry_count)
        else:
            # Unknown strategy, default to abort
            return self.abort_strategy.handle_error(event, self.graph, retry_count)
