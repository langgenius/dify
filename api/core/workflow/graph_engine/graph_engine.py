"""
QueueBasedGraphEngine - Main orchestrator for queue-based workflow execution

This engine replaces the thread pool architecture with a queue-based dispatcher + worker model
for improved control and coordination of workflow execution.
"""

import logging
import queue
import threading
import time
from collections.abc import Callable, Generator, Mapping, Sequence
from typing import Any, Optional, TypedDict, cast

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphRuntimeState
from core.workflow.enums import (
    ErrorStrategy,
    NodeExecutionType,
    NodeState,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.graph import Edge, Graph
from core.workflow.graph_events import (
    GraphEngineEvent,
    GraphNodeEventBase,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
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
from core.workflow.node_events import NodeRunResult
from models.enums import UserFrom

from .entities.commands import AbortCommand, CommandType, GraphEngineCommand
from .executing_nodes_manager import ExecutingNodesManager
from .layers.base import Layer
from .output_registry import OutputRegistry
from .protocols.command_channel import CommandChannel
from .response_coordinator import ResponseStreamCoordinator
from .worker import Worker

logger = logging.getLogger(__name__)


class _EdgeStateAnalysis(TypedDict):
    """Analysis result for edge states."""

    has_unknown: bool
    has_taken: bool
    all_skipped: bool


class GraphEngine:
    """
    Queue-based graph execution engine.

    Uses a single dispatcher thread + 10 worker threads with queues for
    communication instead of the traditional thread pool approach.
    """

    def __init__(
        self,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        user_id: str,
        user_from: UserFrom,
        invoke_from: InvokeFrom,
        call_depth: int,
        graph: Graph,
        graph_config: Mapping[str, Any],
        graph_runtime_state: GraphRuntimeState,
        max_execution_steps: int,
        max_execution_time: int,
        command_channel: CommandChannel,
    ) -> None:
        """
        Initialize queue-based graph engine.

        Args:
            tenant_id: Tenant identifier
            app_id: Application identifier
            workflow_id: Workflow identifier
            user_id: User identifier
            user_from: Source of user (ACCOUNT, etc.)
            invoke_from: Invocation source (WEB_APP, etc.)
            call_depth: Nested call depth
            graph: Graph to execute
            graph_config: Graph configuration
            graph_runtime_state: Runtime state
            max_execution_steps: Maximum execution steps
            max_execution_time: Maximum execution time in seconds
            command_channel: Channel for receiving external commands
        """
        # Store initialization parameters
        self.tenant_id = tenant_id
        self.app_id = app_id
        self.workflow_id = workflow_id
        self.user_id = user_id
        self.user_from = user_from
        self.invoke_from = invoke_from
        self.call_depth = call_depth
        self.graph = graph
        self.graph_config = graph_config
        self.graph_runtime_state = graph_runtime_state
        self.max_execution_steps = max_execution_steps
        self.max_execution_time = max_execution_time
        self.command_channel = command_channel

        # Core queue-based architecture components
        self.ready_queue: queue.Queue[str] = queue.Queue()
        self.event_queue: queue.Queue[GraphNodeEventBase] = queue.Queue()
        self.state_lock = threading.RLock()

        # Subsystems
        self.output_registry = OutputRegistry(self.graph_runtime_state.variable_pool)
        self.response_coordinator = ResponseStreamCoordinator(registry=self.output_registry, graph=self.graph)

        # Worker threads (10 workers as specified)
        self.workers: list[Worker] = []
        for i in range(10):
            worker = Worker(
                ready_queue=self.ready_queue,
                event_queue=self.event_queue,
                graph=self.graph,
                worker_id=i,
            )
            self.workers.append(worker)

        # Dispatcher thread
        self.dispatcher_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._execution_complete = threading.Event()

        # Execution state
        self._started = False
        self._error: Optional[Exception] = None
        self._aborted = False

        # Event collection for generator
        self._collected_events: list[GraphEngineEvent] = []
        self._event_collector_lock = threading.Lock()

        # Track nodes currently being executed
        self._executing_nodes_manager = ExecutingNodesManager()

        # Private map to track node retry attempts
        # Key: node_id, Value: retry_count
        self._node_retry_tracker: dict[str, int] = {}

        # Layer system for extensibility
        self._layers: list[Layer] = []

        # Validate that all nodes share the same GraphRuntimeState instance
        # This is critical for thread-safe execution and consistent state management
        expected_state_id = id(self.graph_runtime_state)
        for node in self.graph.nodes.values():
            if id(node.graph_runtime_state) != expected_state_id:
                raise ValueError(
                    f"GraphRuntimeState consistency violation: Node '{node.id}' has a different "
                    f"GraphRuntimeState instance than the engine. All nodes must share the same "
                    f"GraphRuntimeState instance for proper execution."
                )

    def layer(self, layer: Layer) -> "GraphEngine":
        """
        Add a layer to the engine for extending functionality.

        Layers can observe events, access runtime state, and send commands.
        Multiple layers can be chained using the fluent API.

        Args:
            layer: The layer instance to add

        Returns:
            Self for method chaining

        Example:
            engine.layer(DebugLoggingLayer()).layer(TracingLayer()).run()
        """
        self._layers.append(layer)
        return self

    def _initialize_layers(self) -> None:
        """Initialize all registered layers with engine context."""
        for layer in self._layers:
            try:
                layer.initialize(self.graph_runtime_state, self.command_channel)
            except Exception as e:
                logger.warning("Failed to initialize layer %s: %s", layer.__class__.__name__, e)

    def _notify_layers_event(self, event: GraphEngineEvent) -> None:
        """
        Notify all layers of an event.

        Layer exceptions are caught and logged to prevent disrupting execution.

        Args:
            event: The event to send to all layers
        """
        for layer in self._layers:
            try:
                layer.on_event(event)
            except Exception as e:
                logger.warning(
                    "Layer %s failed to process event %s: %s", layer.__class__.__name__, event.__class__.__name__, e
                )

    def run(self) -> Generator[GraphEngineEvent, None, None]:
        """
        Execute the graph and yield events as they occur.

        Returns:
            Generator yielding GraphEngineEvent instances during execution
        """
        try:
            # Initialize layers with engine context
            self._initialize_layers()

            # Notify layers of graph start
            for layer in self._layers:
                try:
                    layer.on_graph_start()
                except Exception as e:
                    logger.warning("Layer %s failed on_graph_start: %s", layer.__class__.__name__, e)

            # Yield initial start event
            start_event = GraphRunStartedEvent()
            yield start_event
            self._notify_layers_event(start_event)

            # Start execution
            self._start_execution()

            # Yield events as they're generated
            yield from self._event_generator()

            # Check for abort
            if self._aborted:
                abort_event = GraphRunAbortedEvent(
                    reason="Workflow execution aborted by user command",
                    outputs=self.graph_runtime_state.outputs,
                )
                self._notify_layers_event(abort_event)
                yield abort_event
                return

            # Check for errors
            if self._error:
                raise self._error

            # Yield completion event
            success_event = GraphRunSucceededEvent(
                outputs=self.graph_runtime_state.outputs,
            )
            self._notify_layers_event(success_event)
            yield success_event

        except Exception as e:
            # Yield failure event
            failure_event = GraphRunFailedEvent(
                error=str(e),
            )
            self._notify_layers_event(failure_event)
            yield failure_event
            raise

        finally:
            # Notify layers of graph end
            for layer in self._layers:
                try:
                    layer.on_graph_end(self._error)
                except Exception as layer_e:
                    logger.warning("Layer %s failed on_graph_end: %s", layer.__class__.__name__, layer_e)

            # Clean up
            self._stop_execution()

    def _start_execution(self) -> None:
        """Start the execution by launching workers and dispatcher."""
        if self._started:
            return

        self._started = True

        # Start all worker threads
        for worker in self.workers:
            worker.start()

        # Register all response nodes at startup
        for node in (node for node in self.graph.nodes.values() if node.execution_type == NodeExecutionType.RESPONSE):
            self.response_coordinator.register(node.id)

        root_node = self.graph.root_node
        self._enqueue_node(root_node.id)

        # Start dispatcher thread
        self.dispatcher_thread = threading.Thread(target=self._dispatcher_loop, name="GraphDispatcher", daemon=True)
        self.dispatcher_thread.start()

    def _stop_execution(self) -> None:
        """Stop execution and clean up threads."""
        # Signal stop
        self._stop_event.set()

        # Stop all workers
        for worker in self.workers:
            worker.stop()

        # Wait for workers to finish
        for worker in self.workers:
            if worker.is_alive():
                worker.join(timeout=10.0)

        # Wait for dispatcher
        if self.dispatcher_thread and self.dispatcher_thread.is_alive():
            self.dispatcher_thread.join(timeout=10.0)

    def _dispatcher_loop(self) -> None:
        """Main dispatcher loop that processes events from workers."""
        start_time = time.time()

        try:
            while not self._stop_event.is_set():
                # Check for commands from external sources
                self._check_commands()

                # Check for timeout
                if time.time() - start_time > self.max_execution_time:
                    raise TimeoutError(f"Execution exceeded maximum time of {self.max_execution_time} seconds")

                try:
                    # Get event from queue with timeout
                    event = self.event_queue.get(timeout=0.1)

                    # Process the event
                    self._process_event(event)

                    # Mark task done
                    self.event_queue.task_done()

                except queue.Empty:
                    # Check if we should exit (no more work) after some empty cycles
                    if self._should_complete_execution():
                        break

            # Mark execution as complete
            self._execution_complete.set()

        except Exception as e:
            self._error = e
            self._execution_complete.set()

    def _process_event(self, event: GraphNodeEventBase) -> None:
        """
        Process an event from the event queue based on its type.

        Args:
            event: The event to process
        """
        # Dispatch to appropriate handler based on event type
        if isinstance(event, NodeRunSucceededEvent | NodeRunFailedEvent) and (
            event.in_loop_id or event.in_iteration_id
        ):
            self._collect_event(event)
            return
        handler = self._get_event_handler(type(event))
        if handler:
            handler(event)
        else:
            # TODO(-LAN-): temp code.
            self._collect_event(event)
            logger.warning("no handler for event: %r", event)

    def _collect_event(self, event: GraphNodeEventBase) -> None:
        """
        Thread-safe method to append an event to the collected events list.

        Args:
            event: The event to append to the collection.
        """
        with self._event_collector_lock:
            # Add event to collection
            self._collected_events.append(event)
            # Notify layers of the event
            self._notify_layers_event(event)

    def _get_event_handler(self, event_type: type[GraphEngineEvent]) -> Callable[[Any], None] | None:
        """
        Get the appropriate handler for an event type.

        Args:
            event_type: The type of event to handle

        Returns:
            The handler function for the event type, or None if no handler exists
        """
        # Event type to handler mapping
        handlers: dict[type[GraphEngineEvent], Callable[[Any], None]] = {
            NodeRunStartedEvent: self._handle_node_started_event,
            NodeRunStreamChunkEvent: self._handle_stream_chunk_event,
            NodeRunSucceededEvent: self._handle_node_succeeded_event,
            NodeRunFailedEvent: self._handle_node_failed_event,
            NodeRunExceptionEvent: self._handle_node_exception_event,
            # Output directly.
            NodeRunIterationStartedEvent: self._collect_event,
            NodeRunIterationNextEvent: self._collect_event,
            NodeRunIterationSucceededEvent: self._collect_event,
            NodeRunIterationFailedEvent: self._collect_event,
            NodeRunLoopStartedEvent: self._collect_event,
            NodeRunLoopNextEvent: self._collect_event,
            NodeRunLoopSucceededEvent: self._collect_event,
            NodeRunLoopFailedEvent: self._collect_event,
        }

        return handlers.get(event_type)

    def _handle_node_started_event(self, event: NodeRunStartedEvent) -> None:
        """
        Handle NodeRunStartedEvent by tracking execution ID in RSC.

        Args:
            event: The node started event to handle
        """
        # Track the execution ID in RSC for proper stream event generation
        self.response_coordinator.track_node_execution(event.node_id, event.id)
        if event.node_id in self._node_retry_tracker:
            return
        self._collect_event(event)

    def _handle_stream_chunk_event(self, event: NodeRunStreamChunkEvent) -> None:
        """
        Handle NodeRunStreamChunkEvent by forwarding to RSC.

        Args:
            event: The stream chunk event to handle
        """
        self._forward_event_to_rsc(event)

    def _handle_node_succeeded_event(self, event: NodeRunSucceededEvent) -> None:
        """
        Handle NodeRunSucceededEvent by updating status and checking downstream nodes.

        Args:
            event: The node succeeded event to handle
        """
        node = self.graph.nodes[event.node_id]
        # Store outputs and notify RSC
        self._store_node_outputs(event)
        self._forward_event_to_rsc(event)

        # Process downstream edges based on node type
        if node.execution_type != NodeExecutionType.BRANCH:
            self._process_non_branch_node_edges(event.node_id)
        else:
            self._process_branch_node_edges(event.node_id, event.node_run_result.edge_source_handle)

        self._executing_nodes_manager.remove(event.node_id)

        # Clean up retry tracker for successful node
        if event.node_id in self._node_retry_tracker:
            del self._node_retry_tracker[event.node_id]

        if node.execution_type == NodeExecutionType.RESPONSE:
            self.graph_runtime_state.outputs.update(event.node_run_result.outputs)

        self._collect_event(event)

    def _store_node_outputs(self, event: NodeRunSucceededEvent) -> None:
        """
        Store node outputs in the variable pool.

        Args:
            event: The node succeeded event containing outputs
        """
        for variable_name, variable_value in event.node_run_result.outputs.items():
            self.graph_runtime_state.variable_pool.add((event.node_id, variable_name), variable_value)

    def _forward_event_to_rsc(self, event: NodeRunSucceededEvent | NodeRunStreamChunkEvent) -> None:
        """
        Forward node execution events to the Response Stream Coordinator for ordered streaming.

        The RSC intercepts events to manage response streaming sessions, ensuring proper
        ordering based on upstream node outputs and constants. For succeeded events, it
        registers scalar outputs; for stream chunk events, it buffers chunks until ready
        to emit in the correct order.

        Args:
            event: Node execution event (succeeded or stream chunk) to be processed by RSC
        """
        new_events = self.response_coordinator.intercept_event(event)
        self._emit_streaming_events(new_events)

    def _process_non_branch_node_edges(self, node_id: str) -> None:
        """
        Process edges for non-branch nodes (mark all as TAKEN).

        Args:
            node_id: The ID of the succeeded node
        """
        outgoing_edges = self.graph.get_outgoing_edges(node_id)
        for edge in outgoing_edges:
            self._process_taken_edge(edge)

    def _process_branch_node_edges(self, node_id: str, selected_handle: str | None) -> None:
        """
        Process edges for branch nodes (mark selected as TAKEN, others as SKIPPED).

        Args:
            node_id: The ID of the branch node
            selected_handle: The handle of the selected edge

        Raises:
            ValueError: If no edge was selected by the branch node
        """
        if not selected_handle:
            raise ValueError(f"Branch node {node_id} did not select any edge")

        # Categorize edges as selected or unselected
        selected_edges, unselected_edges = self._categorize_branch_edges(node_id, selected_handle)

        # Process unselected edges first (mark as skipped)
        self._process_skipped_edges(unselected_edges)

        # Process selected edges (mark as taken)
        for edge in selected_edges:
            self._process_taken_edge(edge)

    def _categorize_branch_edges(self, node_id: str, selected_handle: str) -> tuple[list[Edge], list[Edge]]:
        """
        Categorize branch edges into selected and unselected.

        Args:
            node_id: The ID of the branch node
            selected_handle: The handle of the selected edge

        Returns:
            A tuple of (selected_edges, unselected_edges)
        """
        outgoing_edges = self.graph.get_outgoing_edges(node_id)
        selected_edges = []
        unselected_edges = []

        for edge in outgoing_edges:
            if edge.source_handle == selected_handle:
                selected_edges.append(edge)
            else:
                unselected_edges.append(edge)

        return selected_edges, unselected_edges

    def _process_skipped_edges(self, edges: list[Edge]) -> None:
        """
        Mark edges as skipped and recursively skip downstream paths.

        Args:
            edges: List of edges to mark as skipped
        """
        for edge in edges:
            edge.state = NodeState.SKIPPED
            self._recursively_mark_skipped_from_edge(edge.id)

    def _process_taken_edge(self, edge: Edge) -> None:
        """
        Mark edge as taken, notify RSC, and enqueue downstream node if ready.

        Args:
            edge: The edge to process as taken
        """
        edge.state = NodeState.TAKEN

        # Notify RSC of edge taken
        edge_events = self.response_coordinator.on_edge_taken(edge.id)
        self._emit_streaming_events(edge_events)

        # Check and enqueue downstream node if ready
        if self._is_node_ready(edge.head):
            self._enqueue_node(edge.head)

    def _handle_node_failed_event(self, event: NodeRunFailedEvent) -> None:
        """
        Handle NodeRunFailedEvent based on error strategy.

        Args:
            event: The node failed event to handle
        """

        node = self.graph.nodes[event.node_id]
        strategy = node.error_strategy

        current_retry_count = self._node_retry_tracker.get(event.node_id, 0)
        if node.retry and current_retry_count < node.retry_config.max_retries:
            self._handle_retry_strategy(event)
        elif strategy is None:
            self._handle_abort_strategy(event)
        elif strategy == ErrorStrategy.FAIL_BRANCH:
            self._handle_fail_branch_strategy(event)
        elif strategy == ErrorStrategy.DEFAULT_VALUE:
            self._handle_default_value_strategy(event)

    def _handle_abort_strategy(self, event: NodeRunFailedEvent) -> None:
        """
        Handle ABORT error strategy by serializing state and exiting.

        Args:
            event: The node failed event
        """
        # Serialize state & exit
        self._collect_event(event)
        self._executing_nodes_manager.remove(event.node_id)
        logger.error(
            {
                "event_type": type(event),
                "error_message": event.error,
                "event": event,
            }
        )
        self._error = RuntimeError(event.error)
        self._stop_event.set()

    def _handle_retry_strategy(self, event: NodeRunFailedEvent) -> None:
        """
        Handle RETRY error strategy by re-enqueueing the node.

        Args:
            event: The node failed event
        """
        node = self.graph.nodes[event.node_id]

        # Get current retry count for this node
        current_retry_count = self._node_retry_tracker.get(event.node_id, 0)

        # Update retry count
        current_retry_count += 1
        self._node_retry_tracker[event.node_id] = current_retry_count

        # Wait for retry interval if specified
        time.sleep(node.retry_config.retry_interval_seconds)

        # emit a retry event
        retry_event = NodeRunRetryEvent(
            id=event.id,
            node_title=node.title,
            node_id=event.node_id,
            node_type=event.node_type,
            node_run_result=event.node_run_result,
            start_at=event.start_at,
            error=event.error,
            retry_index=current_retry_count,
        )
        self._collect_event(retry_event)

        self._enqueue_node(event.node_id)

    def _handle_fail_branch_strategy(self, event: NodeRunFailedEvent) -> None:
        """
        Handle FAIL_BRANCH error strategy by force-taking a specific edge.

        Args:
            event: The node failed event
        """
        outputs = {
            "error_message": event.node_run_result.error,
            "error_type": event.node_run_result.error_type,
        }
        converted_event = NodeRunExceptionEvent(
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
                    WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: ErrorStrategy.FAIL_BRANCH,
                },
            ),
            error=event.error,
        )
        self._process_event(converted_event)

    def _handle_default_value_strategy(self, event: NodeRunFailedEvent) -> None:
        """
        Handle DEFAULT_VALUE error strategy by using default value.

        Args:
            event: The node failed event
        """
        node = self.graph.nodes[event.node_id]
        outputs = {
            **node.default_value_dict,
            "error_message": event.node_run_result.error,
            "error_type": event.node_run_result.error_type,
        }
        converted_event = NodeRunExceptionEvent(
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
                    WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: ErrorStrategy.DEFAULT_VALUE,
                },
            ),
            error=event.error,
        )
        self._process_event(converted_event)

    def _handle_node_exception_event(self, event: NodeRunExceptionEvent) -> None:
        """
        Handle NodeRunExceptionEvent when a node has an exception but continues via fail-branch.

        This event is generated when a node fails with the FAIL_BRANCH error strategy.
        It processes the exception as a special succeeded case, using the fail-branch edge.

        Args:
            event: The node exception event to handle
        """
        self._process_branch_node_edges(event.node_id, event.node_run_result.edge_source_handle)
        self._executing_nodes_manager.remove(event.node_id)
        self._collect_event(event)

    def _handle_container_event(self, event: GraphNodeEventBase) -> None:
        """
        Handle container events by triggering SGE expansion.

        Args:
            event: The container event to handle
        """
        # Trigger SGE expansion
        pass

        # Expand subgraph and add new nodes to graph
        pass

    def _recursively_mark_skipped_from_edge(self, edge_id: str) -> None:
        """
        Recursively mark nodes and edges as SKIPPED starting from a given edge.

        Rules:
        - If a node has any UNKNOWN incoming edges, stop processing
        - If all incoming edges are SKIPPED, mark the node and its outgoing edges as SKIPPED
        - If any incoming edge is TAKEN, stop processing (node may still execute)

        Args:
            edge_id: The ID of the edge to start tracing from
        """
        downstream_node_id = self.graph.edges[edge_id].head
        incoming_edges = self.graph.get_incoming_edges(downstream_node_id)

        edge_states = self._analyze_edge_states(incoming_edges)

        if edge_states["has_unknown"]:
            return

        if edge_states["has_taken"]:
            self._handle_taken_edges(downstream_node_id)
            return

        if edge_states["all_skipped"]:
            self._propagate_skip_state(downstream_node_id)

    def _analyze_edge_states(self, edges: Sequence) -> _EdgeStateAnalysis:
        """Analyze the states of edges and return summary flags."""
        states = {edge.state for edge in edges}

        return _EdgeStateAnalysis(
            has_unknown=NodeState.UNKNOWN in states,
            has_taken=NodeState.TAKEN in states,
            all_skipped=states == {NodeState.SKIPPED} if states else True,
        )

    def _handle_taken_edges(self, node_id: str) -> None:
        """Handle node when it has taken incoming edges."""
        if self._is_node_ready(node_id):
            self._enqueue_node(node_id)

    def _propagate_skip_state(self, node_id: str) -> None:
        """Propagate SKIPPED state to node and its outgoing edges."""
        self.graph.nodes[node_id].state = NodeState.SKIPPED

        outgoing_edges = self.graph.get_outgoing_edges(node_id)
        for edge in outgoing_edges:
            edge_id = edge.id
            edge.state = NodeState.SKIPPED
            self._recursively_mark_skipped_from_edge(edge_id)

    def _enqueue_node(self, node_id: str) -> None:
        """
        Mark a node as TAKEN and add it to the ready queue.

        This private method combines the two operations that are always performed together
        when preparing a node for execution.

        Args:
            node_id: The ID of the node to mark and enqueue
        """
        self.graph.nodes[node_id].state = NodeState.TAKEN
        self.ready_queue.put(node_id)
        self._executing_nodes_manager.add(node_id)

    def _is_node_ready(self, node_id: str) -> bool:
        """
        Check if a node is ready to be executed.

        A node is ready when all its incoming edges from taken branches have been satisfied.

        Args:
            node_id: The ID of the node to check

        Returns:
            True if the node is ready for execution
        """
        # Get all incoming edges to this node
        incoming_edges = self.graph.get_incoming_edges(node_id)

        # If no incoming edges, node is always ready
        if not incoming_edges:
            return True

        # If any edge is UNKNOWN, node is not ready
        if any(edge.state == NodeState.UNKNOWN for edge in incoming_edges):
            return False

        # Node is ready if at least one edge is TAKEN
        return any(edge.state == NodeState.TAKEN for edge in incoming_edges)

    def _should_complete_execution(self) -> bool:
        """
        Check if execution should be considered complete.

        Returns:
            True if execution should complete
        """
        # Complete if:
        # 1. Ready queue is empty (no nodes waiting to be executed)
        # 2. Event queue is empty (no events to process)
        # 3. No nodes are currently being executed
        no_executing_nodes = self._executing_nodes_manager.is_empty()

        return self.ready_queue.empty() and self.event_queue.empty() and no_executing_nodes

    def _event_generator(self) -> Generator[GraphEngineEvent, None, None]:
        """
        Generator that yields events as they're collected.

        Yields:
            GraphEngineEvent instances as they're processed
        """
        yielded_count = 0

        while not self._execution_complete.is_set() or yielded_count < len(self._collected_events):
            with self._event_collector_lock:
                # Yield any new events
                while yielded_count < len(self._collected_events):
                    yield self._collected_events[yielded_count]
                    yielded_count += 1

            # Small sleep to avoid busy waiting
            if not self._execution_complete.is_set():
                time.sleep(0.001)

    def _emit_streaming_events(self, streaming_events: Sequence[NodeRunStreamChunkEvent]) -> None:
        """
        Emit streaming events created by the RSC.

        Args:
            streaming_events: List of GraphEngineEvent instances from RSC
        """
        for event in streaming_events:
            # Add to collected events to be yielded
            self._collect_event(event)

    def _check_commands(self) -> None:
        """Check for and process any pending commands from the command channel."""
        try:
            commands = self.command_channel.fetch_commands()
            for command in commands:
                self._handle_command(command)
        except Exception as e:
            logger.warning("Error checking commands: %s", e)

    def _handle_command(self, command: GraphEngineCommand) -> None:
        """
        Handle a command received from the command channel.

        Args:
            command: The command to handle
        """
        if command.command_type == CommandType.ABORT:
            self._handle_abort_command(cast(AbortCommand, command))
        # Add other command type handlers here as needed

    def _handle_abort_command(self, command: AbortCommand) -> None:
        """
        Handle an abort command by gracefully stopping execution.

        Args:
            command: The abort command
        """
        logger.info("Received abort command for workflow %s: %s", self.workflow_id, command.reason)
        self._aborted = True
        self._stop_event.set()  # Signal all threads to stop
