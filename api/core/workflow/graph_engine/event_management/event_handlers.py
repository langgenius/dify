"""
Event handler implementations for different event types.
"""

import logging
from collections.abc import Mapping
from functools import singledispatchmethod
from typing import TYPE_CHECKING, final

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.enums import ErrorStrategy, NodeExecutionType, NodeState
from core.workflow.graph import Graph
from core.workflow.graph_events import (
    GraphNodeEventBase,
    NodeRunAgentLogEvent,
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
    NodeRunPauseRequestedEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.runtime import GraphRuntimeState

from ..domain.graph_execution import GraphExecution
from ..response_coordinator import ResponseStreamCoordinator

if TYPE_CHECKING:
    from ..error_handler import ErrorHandler
    from ..graph_state_manager import GraphStateManager
    from ..graph_traversal import EdgeProcessor
    from .event_manager import EventManager

logger = logging.getLogger(__name__)


@final
class EventHandler:
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
        event_collector: "EventManager",
        edge_processor: "EdgeProcessor",
        state_manager: "GraphStateManager",
        error_handler: "ErrorHandler",
    ) -> None:
        """
        Initialize the event handler registry.

        Args:
            graph: The workflow graph
            graph_runtime_state: Runtime state with variable pool
            graph_execution: Graph execution aggregate
            response_coordinator: Response stream coordinator
            event_collector: Event manager for collecting events
            edge_processor: Edge processor for edge traversal
            state_manager: Unified state manager
            error_handler: Error handler
        """
        self._graph = graph
        self._graph_runtime_state = graph_runtime_state
        self._graph_execution = graph_execution
        self._response_coordinator = response_coordinator
        self._event_collector = event_collector
        self._edge_processor = edge_processor
        self._state_manager = state_manager
        self._error_handler = error_handler

    def dispatch(self, event: GraphNodeEventBase) -> None:
        """
        Handle any node event by dispatching to the appropriate handler.

        Args:
            event: The event to handle
        """
        # Events in loops or iterations are always collected
        if event.in_loop_id or event.in_iteration_id:
            self._event_collector.collect(event)
            return
        return self._dispatch(event)

    @singledispatchmethod
    def _dispatch(self, event: GraphNodeEventBase) -> None:
        self._event_collector.collect(event)
        logger.warning("Unhandled event type: %s", type(event).__name__)

    @_dispatch.register(NodeRunIterationStartedEvent)
    @_dispatch.register(NodeRunIterationNextEvent)
    @_dispatch.register(NodeRunIterationSucceededEvent)
    @_dispatch.register(NodeRunIterationFailedEvent)
    @_dispatch.register(NodeRunLoopStartedEvent)
    @_dispatch.register(NodeRunLoopNextEvent)
    @_dispatch.register(NodeRunLoopSucceededEvent)
    @_dispatch.register(NodeRunLoopFailedEvent)
    @_dispatch.register(NodeRunAgentLogEvent)
    @_dispatch.register(NodeRunRetrieverResourceEvent)
    def _(self, event: GraphNodeEventBase) -> None:
        self._event_collector.collect(event)

    @_dispatch.register
    def _(self, event: NodeRunStartedEvent) -> None:
        """
        Handle node started event.

        Args:
            event: The node started event
        """
        # Track execution in domain model
        node_execution = self._graph_execution.get_or_create_node_execution(event.node_id)
        is_initial_attempt = node_execution.retry_count == 0
        node_execution.mark_started(event.id)
        self._graph_runtime_state.increment_node_run_steps()

        # Track in response coordinator for stream ordering
        self._response_coordinator.track_node_execution(event.node_id, event.id)

        # Collect the event only for the first attempt; retries remain silent
        if is_initial_attempt:
            self._event_collector.collect(event)

    @_dispatch.register
    def _(self, event: NodeRunStreamChunkEvent) -> None:
        """
        Handle stream chunk event with full processing.

        Args:
            event: The stream chunk event
        """
        # Process with response coordinator
        streaming_events = list(self._response_coordinator.intercept_event(event))

        # Collect all events
        for stream_event in streaming_events:
            self._event_collector.collect(stream_event)

    @_dispatch.register
    def _(self, event: NodeRunSucceededEvent) -> None:
        """
        Handle node success by coordinating subsystems.

        This method coordinates between different subsystems to process
        node completion, handle edges, and trigger downstream execution.

        Args:
            event: The node succeeded event
        """
        # Update domain model
        node_execution = self._graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.mark_taken()

        self._accumulate_node_usage(event.node_run_result.llm_usage)

        # Store outputs in variable pool
        self._store_node_outputs(event.node_id, event.node_run_result.outputs)

        # Forward to response coordinator and emit streaming events
        streaming_events = self._response_coordinator.intercept_event(event)
        for stream_event in streaming_events:
            self._event_collector.collect(stream_event)

        # Process edges and get ready nodes
        node = self._graph.nodes[event.node_id]
        if node.execution_type == NodeExecutionType.BRANCH:
            ready_nodes, edge_streaming_events = self._edge_processor.handle_branch_completion(
                event.node_id, event.node_run_result.edge_source_handle
            )
        else:
            ready_nodes, edge_streaming_events = self._edge_processor.process_node_success(event.node_id)

        # Collect streaming events from edge processing
        for edge_event in edge_streaming_events:
            self._event_collector.collect(edge_event)

        # Enqueue ready nodes
        for node_id in ready_nodes:
            self._state_manager.enqueue_node(node_id)
            self._state_manager.start_execution(node_id)

        # Update execution tracking
        self._state_manager.finish_execution(event.node_id)

        # Handle response node outputs
        if node.execution_type == NodeExecutionType.RESPONSE:
            self._update_response_outputs(event.node_run_result.outputs)

        # Collect the event
        self._event_collector.collect(event)

    @_dispatch.register
    def _(self, event: NodeRunPauseRequestedEvent) -> None:
        """Handle pause requests emitted by nodes."""

        pause_reason = event.reason
        self._graph_execution.pause(pause_reason)
        self._state_manager.finish_execution(event.node_id)
        if event.node_id in self._graph.nodes:
            self._graph.nodes[event.node_id].state = NodeState.UNKNOWN
        self._graph_runtime_state.register_paused_node(event.node_id)
        self._event_collector.collect(event)

    @_dispatch.register
    def _(self, event: NodeRunFailedEvent) -> None:
        """
        Handle node failure using error handler.

        Args:
            event: The node failed event
        """
        # Update domain model
        node_execution = self._graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.mark_failed(event.error)
        self._graph_execution.record_node_failure()

        self._accumulate_node_usage(event.node_run_result.llm_usage)

        result = self._error_handler.handle_node_failure(event)

        if result:
            # Process the resulting event (retry, exception, etc.)
            self.dispatch(result)
        else:
            # Abort execution
            self._graph_execution.fail(RuntimeError(event.error))
            self._event_collector.collect(event)
            self._state_manager.finish_execution(event.node_id)

    @_dispatch.register
    def _(self, event: NodeRunExceptionEvent) -> None:
        """
        Handle node exception event (fail-branch strategy).

        Args:
            event: The node exception event
        """
        # Node continues via fail-branch/default-value, treat as completion
        node_execution = self._graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.mark_taken()

        self._accumulate_node_usage(event.node_run_result.llm_usage)

        # Persist outputs produced by the exception strategy (e.g. default values)
        self._store_node_outputs(event.node_id, event.node_run_result.outputs)

        node = self._graph.nodes[event.node_id]

        if node.error_strategy == ErrorStrategy.DEFAULT_VALUE:
            ready_nodes, edge_streaming_events = self._edge_processor.process_node_success(event.node_id)
        elif node.error_strategy == ErrorStrategy.FAIL_BRANCH:
            ready_nodes, edge_streaming_events = self._edge_processor.handle_branch_completion(
                event.node_id, event.node_run_result.edge_source_handle
            )
        else:
            raise NotImplementedError(f"Unsupported error strategy: {node.error_strategy}")

        for edge_event in edge_streaming_events:
            self._event_collector.collect(edge_event)

        for node_id in ready_nodes:
            self._state_manager.enqueue_node(node_id)
            self._state_manager.start_execution(node_id)

        # Update response outputs if applicable
        if node.execution_type == NodeExecutionType.RESPONSE:
            self._update_response_outputs(event.node_run_result.outputs)

        self._state_manager.finish_execution(event.node_id)

        # Collect the exception event for observers
        self._event_collector.collect(event)

    @_dispatch.register
    def _(self, event: NodeRunRetryEvent) -> None:
        """
        Handle node retry event.

        Args:
            event: The node retry event
        """
        node_execution = self._graph_execution.get_or_create_node_execution(event.node_id)
        node_execution.increment_retry()

        # Finish the previous attempt before re-queuing the node
        self._state_manager.finish_execution(event.node_id)

        # Emit retry event for observers
        self._event_collector.collect(event)

        # Re-queue node for execution
        self._state_manager.enqueue_node(event.node_id)
        self._state_manager.start_execution(event.node_id)

    def _accumulate_node_usage(self, usage: LLMUsage) -> None:
        """Accumulate token usage into the shared runtime state."""
        if usage.total_tokens <= 0:
            return

        self._graph_runtime_state.add_tokens(usage.total_tokens)

        current_usage = self._graph_runtime_state.llm_usage
        if current_usage.total_tokens == 0:
            self._graph_runtime_state.llm_usage = usage
        else:
            self._graph_runtime_state.llm_usage = current_usage.plus(usage)

    def _store_node_outputs(self, node_id: str, outputs: Mapping[str, object]) -> None:
        """
        Store node outputs in the variable pool.

        Args:
            event: The node succeeded event containing outputs
        """
        for variable_name, variable_value in outputs.items():
            self._graph_runtime_state.variable_pool.add((node_id, variable_name), variable_value)

    def _update_response_outputs(self, outputs: Mapping[str, object]) -> None:
        """Update response outputs for response nodes."""
        # TODO: Design a mechanism for nodes to notify the engine about how to update outputs
        # in runtime state, rather than allowing nodes to directly access runtime state.
        for key, value in outputs.items():
            if key == "answer":
                existing = self._graph_runtime_state.get_output("answer", "")
                if existing:
                    self._graph_runtime_state.set_output("answer", f"{existing}{value}")
                else:
                    self._graph_runtime_state.set_output("answer", value)
            else:
                self._graph_runtime_state.set_output(key, value)
