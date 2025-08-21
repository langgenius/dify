"""
Event handler implementations for different event types.
"""

import logging
from typing import TYPE_CHECKING, Optional

from core.workflow.entities import GraphRuntimeState
from core.workflow.enums import NodeExecutionType
from core.workflow.graph import Graph
from core.workflow.graph_events import (
    GraphNodeEventBase,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunIterationFailedEvent,
    NodeRunIterationNextEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
    NodeRunLoopFailedEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)

from ..domain.graph_execution import GraphExecution
from ..response_coordinator import ResponseStreamCoordinator

if TYPE_CHECKING:
    from ..error_handling import ErrorHandler
    from ..graph_traversal import BranchHandler, EdgeProcessor
    from ..state_management import ExecutionTracker, NodeStateManager
    from .event_collector import EventCollector

logger = logging.getLogger(__name__)


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
        branch_handler: Optional["BranchHandler"] = None,
        edge_processor: Optional["EdgeProcessor"] = None,
        node_state_manager: Optional["NodeStateManager"] = None,
        execution_tracker: Optional["ExecutionTracker"] = None,
        error_handler: Optional["ErrorHandler"] = None,
    ) -> None:
        """
        Initialize the event handler registry.

        Args:
            graph: The workflow graph
            graph_runtime_state: Runtime state with variable pool
            graph_execution: Graph execution aggregate
            response_coordinator: Response stream coordinator
            event_collector: Optional event collector for collecting events
            branch_handler: Optional branch handler for branch node processing
            edge_processor: Optional edge processor for edge traversal
            node_state_manager: Optional node state manager
            execution_tracker: Optional execution tracker
            error_handler: Optional error handler
        """
        self.graph = graph
        self.graph_runtime_state = graph_runtime_state
        self.graph_execution = graph_execution
        self.response_coordinator = response_coordinator
        self.event_collector = event_collector
        self.branch_handler = branch_handler
        self.edge_processor = edge_processor
        self.node_state_manager = node_state_manager
        self.execution_tracker = execution_tracker
        self.error_handler = error_handler

    def handle_event(self, event: GraphNodeEventBase) -> None:
        """
        Handle any node event by dispatching to the appropriate handler.

        Args:
            event: The event to handle
        """
        # Events in loops or iterations are always collected
        if isinstance(event, GraphNodeEventBase) and (event.in_loop_id or event.in_iteration_id):
            if self.event_collector:
                self.event_collector.collect(event)
            return

        # Handle specific event types
        if isinstance(event, NodeRunStartedEvent):
            self._handle_node_started(event)
        elif isinstance(event, NodeRunStreamChunkEvent):
            self._handle_stream_chunk(event)
        elif isinstance(event, NodeRunSucceededEvent):
            self._handle_node_succeeded(event)
        elif isinstance(event, NodeRunFailedEvent):
            self._handle_node_failed(event)
        elif isinstance(event, NodeRunExceptionEvent):
            self._handle_node_exception(event)
        elif isinstance(event, NodeRunRetryEvent):
            self._handle_node_retry(event)
        elif isinstance(
            event,
            (
                NodeRunIterationStartedEvent,
                NodeRunIterationNextEvent,
                NodeRunIterationSucceededEvent,
                NodeRunIterationFailedEvent,
                NodeRunLoopStartedEvent,
                NodeRunLoopNextEvent,
                NodeRunLoopSucceededEvent,
                NodeRunLoopFailedEvent,
            ),
        ):
            # Iteration and loop events are collected directly
            if self.event_collector:
                self.event_collector.collect(event)
        else:
            # Collect unhandled events
            if self.event_collector:
                self.event_collector.collect(event)
            logger.warning("Unhandled event type: %s", type(event).__name__)

    def _handle_node_started(self, event: NodeRunStartedEvent) -> None:
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

    def _handle_stream_chunk(self, event: NodeRunStreamChunkEvent) -> None:
        """
        Handle stream chunk event with full processing.

        Args:
            event: The stream chunk event
        """
        # Process with response coordinator
        streaming_events = list(self.response_coordinator.intercept_event(event))

        # Collect all events
        if self.event_collector:
            for stream_event in streaming_events:
                self.event_collector.collect(stream_event)

    def _handle_node_succeeded(self, event: NodeRunSucceededEvent) -> None:
        """
        Handle node success by coordinating subsystems.

        This method coordinates between different subsystems to process
        node completion, handle edges, and trigger downstream execution.

        Args:
            event: The node succeeded event
        """
        # Update domain model
        node_execution = self.graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.mark_taken()

        # Store outputs in variable pool
        self._store_node_outputs(event)

        # Forward to response coordinator and emit streaming events
        streaming_events = list(self.response_coordinator.intercept_event(event))
        if self.event_collector:
            for stream_event in streaming_events:
                self.event_collector.collect(stream_event)

        # Process edges and get ready nodes
        node = self.graph.nodes[event.node_id]
        if node.execution_type == NodeExecutionType.BRANCH:
            if self.branch_handler:
                ready_nodes, edge_streaming_events = self.branch_handler.handle_branch_completion(
                    event.node_id, event.node_run_result.edge_source_handle
                )
            else:
                ready_nodes, edge_streaming_events = [], []
        else:
            if self.edge_processor:
                ready_nodes, edge_streaming_events = self.edge_processor.process_node_success(event.node_id)
            else:
                ready_nodes, edge_streaming_events = [], []

        # Collect streaming events from edge processing
        if self.event_collector:
            for edge_event in edge_streaming_events:
                self.event_collector.collect(edge_event)

        # Enqueue ready nodes
        if self.node_state_manager and self.execution_tracker:
            for node_id in ready_nodes:
                self.node_state_manager.enqueue_node(node_id)
                self.execution_tracker.add(node_id)

        # Update execution tracking
        if self.execution_tracker:
            self.execution_tracker.remove(event.node_id)

        # Handle response node outputs
        if node.execution_type == NodeExecutionType.RESPONSE:
            self._update_response_outputs(event)

        # Collect the event
        if self.event_collector:
            self.event_collector.collect(event)

    def _handle_node_failed(self, event: NodeRunFailedEvent) -> None:
        """
        Handle node failure using error handler.

        Args:
            event: The node failed event
        """
        # Update domain model
        node_execution = self.graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.mark_failed(event.error)

        if self.error_handler:
            result = self.error_handler.handle_node_failure(event)

            if result:
                # Process the resulting event (retry, exception, etc.)
                self.handle_event(result)
            else:
                # Abort execution
                self.graph_execution.fail(RuntimeError(event.error))
                if self.event_collector:
                    self.event_collector.collect(event)
                if self.execution_tracker:
                    self.execution_tracker.remove(event.node_id)
        else:
            # Without error handler, just fail
            self.graph_execution.fail(RuntimeError(event.error))
            if self.event_collector:
                self.event_collector.collect(event)
            if self.execution_tracker:
                self.execution_tracker.remove(event.node_id)

    def _handle_node_exception(self, event: NodeRunExceptionEvent) -> None:
        """
        Handle node exception event (fail-branch strategy).

        Args:
            event: The node exception event
        """
        # Node continues via fail-branch, so it's technically "succeeded"
        node_execution = self.graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.mark_taken()

    def _handle_node_retry(self, event: NodeRunRetryEvent) -> None:
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

    def _update_response_outputs(self, event: NodeRunSucceededEvent) -> None:
        """Update response outputs for response nodes."""
        for key, value in event.node_run_result.outputs.items():
            if key == "answer":
                existing = self.graph_runtime_state.outputs.get("answer", "")
                if existing:
                    self.graph_runtime_state.outputs["answer"] = f"{existing}{value}"
                else:
                    self.graph_runtime_state.outputs["answer"] = value
            else:
                self.graph_runtime_state.outputs[key] = value
