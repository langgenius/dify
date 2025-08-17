"""
Event handler implementations for different event types.
"""

import logging
from typing import TYPE_CHECKING, Optional, Protocol

from core.workflow.entities import GraphRuntimeState
from core.workflow.graph import Graph
from core.workflow.graph_events import (
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)

from ..domain.graph_execution import GraphExecution
from ..response_coordinator import ResponseStreamCoordinator

if TYPE_CHECKING:
    from .event_collector import EventCollector

logger = logging.getLogger(__name__)


class NodeSuccessHandler(Protocol):
    """Protocol for handling node success events."""

    def __call__(self, event: NodeRunSucceededEvent) -> None: ...


class NodeFailureHandler(Protocol):
    """Protocol for handling node failure events."""

    def __call__(self, event: NodeRunFailedEvent) -> None: ...


class EventHandlerRegistry:
    """
    Registry of event handlers for different event types.

    This centralizes the business logic for handling specific events,
    keeping it separate from the routing and collection infrastructure.
    """

    def __init__(
        self,
        graph: Graph,
        graph_runtime_state: GraphRuntimeState,
        graph_execution: GraphExecution,
        response_coordinator: ResponseStreamCoordinator,
        event_collector: Optional["EventCollector"] = None,
    ) -> None:
        """
        Initialize the event handler registry.

        Args:
            graph: The workflow graph
            graph_runtime_state: Runtime state with variable pool
            graph_execution: Graph execution aggregate
            response_coordinator: Response stream coordinator
            event_collector: Optional event collector for collecting events
        """
        self.graph = graph
        self.graph_runtime_state = graph_runtime_state
        self.graph_execution = graph_execution
        self.response_coordinator = response_coordinator
        self.event_collector = event_collector

    def handle_node_started(self, event: NodeRunStartedEvent) -> None:
        """
        Handle node started event.

        Args:
            event: The node started event
        """
        # Track execution in domain model
        node_execution = self.graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.mark_started(event.id)

        # Track in response coordinator for stream ordering
        self.response_coordinator.track_node_execution(event.node_id, event.id)

        # Collect the event
        if self.event_collector:
            self.event_collector.collect(event)

    def handle_stream_chunk(self, event: NodeRunStreamChunkEvent) -> list[NodeRunStreamChunkEvent]:
        """
        Handle stream chunk event.

        Args:
            event: The stream chunk event

        Returns:
            List of new streaming events to emit
        """
        return list(self.response_coordinator.intercept_event(event))

    def handle_node_succeeded(self, event: NodeRunSucceededEvent) -> tuple[list[NodeRunStreamChunkEvent], bool]:
        """
        Handle node succeeded event.

        Args:
            event: The node succeeded event

        Returns:
            Tuple of (streaming events, is_response_node)
        """
        # Update domain model
        node_execution = self.graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.mark_succeeded()

        # Store outputs in variable pool
        self._store_node_outputs(event)

        # Forward to response coordinator
        streaming_events = self.response_coordinator.intercept_event(event)

        # Check if this is a response node
        node = self.graph.nodes[event.node_id]
        from core.workflow.enums import NodeExecutionType

        is_response = node.execution_type == NodeExecutionType.RESPONSE

        return list(streaming_events), is_response

    def handle_node_failed(self, event: NodeRunFailedEvent) -> None:
        """
        Handle node failed event.

        Args:
            event: The node failed event
        """
        # Update domain model
        node_execution = self.graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.mark_failed(event.error)

    def handle_node_exception(self, event: NodeRunExceptionEvent) -> None:
        """
        Handle node exception event (fail-branch strategy).

        Args:
            event: The node exception event
        """
        # Node continues via fail-branch, so it's technically "succeeded"
        node_execution = self.graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.mark_succeeded()

    def handle_node_retry(self, event: NodeRunRetryEvent) -> None:
        """
        Handle node retry event.

        Args:
            event: The node retry event
        """
        node_execution = self.graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.increment_retry()

    def _store_node_outputs(self, event: NodeRunSucceededEvent) -> None:
        """
        Store node outputs in the variable pool.

        Args:
            event: The node succeeded event containing outputs
        """
        for variable_name, variable_value in event.node_run_result.outputs.items():
            self.graph_runtime_state.variable_pool.add((event.node_id, variable_name), variable_value)
