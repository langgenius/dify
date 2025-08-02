"""
QueueBasedGraphEngine - Main orchestrator for queue-based workflow execution

This engine replaces the thread pool architecture with a queue-based dispatcher + worker model
for improved control and coordination of workflow execution.
"""

import queue
import threading
import time
from collections.abc import Generator, Mapping
from typing import Any, Optional

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphRuntimeState
from core.workflow.events import (
    BaseNodeEvent,
    GraphEngineEvent,
    GraphRunFailedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from core.workflow.graph import Graph
from core.workflow.graph_engine.output_registry import OutputRegistry
from core.workflow.graph_engine.response_coordinator import ResponseStreamCoordinator
from core.workflow.graph_engine.worker import Worker
from models.enums import UserFrom
from models.workflow import WorkflowType


class QueueBasedGraphEngine:
    """
    Queue-based graph execution engine.

    Uses a single dispatcher thread + 10 worker threads with queues for
    communication instead of the traditional thread pool approach.
    """

    def __init__(
        self,
        tenant_id: str,
        app_id: str,
        workflow_type: WorkflowType,
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
        thread_pool_id: Optional[str] = None,
    ) -> None:
        """
        Initialize queue-based graph engine.

        Args:
            tenant_id: Tenant identifier
            app_id: Application identifier
            workflow_type: Type of workflow (WORKFLOW or CHAT)
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
            thread_pool_id: Optional thread pool identifier (unused in queue-based)
        """
        # Store initialization parameters
        self.tenant_id = tenant_id
        self.app_id = app_id
        self.workflow_type = workflow_type
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

        # Core queue-based architecture components
        self.ready_queue: queue.Queue[str] = queue.Queue()
        self.event_queue: queue.Queue[GraphEngineEvent] = queue.Queue()
        self.state_lock = threading.RLock()

        # Subsystems
        self.output_registry = OutputRegistry()
        self.response_coordinator = ResponseStreamCoordinator()

        # Worker threads (10 workers as specified)
        self.workers: list[Worker] = []
        for i in range(10):
            worker = Worker(
                ready_queue=self.ready_queue,
                event_queue=self.event_queue,
                graph=self.graph,
                output_registry=self.output_registry,
                worker_id=i,
            )
            self.workers.append(worker)

        # Dispatcher thread
        self.dispatcher_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._execution_complete = threading.Event()

        # Execution state
        self._started = False
        self._completed = False
        self._error: Optional[Exception] = None

        # Event collection for generator
        self._collected_events: list[GraphEngineEvent] = []
        self._event_collector_lock = threading.Lock()

    def run(self) -> Generator[GraphEngineEvent, None, None]:
        """
        Execute the graph and yield events as they occur.

        Returns:
            Generator yielding GraphEngineEvent instances during execution
        """
        try:
            # Start execution
            self._start_execution()

            # Yield initial start event
            start_event = GraphRunStartedEvent()
            yield start_event

            # Yield events as they're generated
            yield from self._event_generator()

            # Check for errors
            if self._error:
                raise self._error

            # Yield completion event
            success_event = GraphRunSucceededEvent(
                outputs=self.graph_runtime_state.outputs or {},
            )
            yield success_event

        except Exception as e:
            # Yield failure event
            failure_event = GraphRunFailedEvent(
                error=str(e),
            )
            yield failure_event
            raise

        finally:
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

        # Find root node and add to ready queue
        if self.graph.root_node:
            self.ready_queue.put(self.graph.root_node.id)
        else:
            # Find nodes with no incoming edges as root nodes
            for node_id, node in self.graph.nodes.items():
                if not self.graph.in_edges.get(node_id):
                    self.ready_queue.put(node_id)

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
                worker.join(timeout=1.0)

        # Wait for dispatcher
        if self.dispatcher_thread and self.dispatcher_thread.is_alive():
            self.dispatcher_thread.join(timeout=1.0)

    def _dispatcher_loop(self) -> None:
        """Main dispatcher loop that processes events from workers."""
        start_time = time.time()

        try:
            # Give workers a moment to start
            time.sleep(0.01)

            while not self._stop_event.is_set():
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
                        # Wait a bit more to make sure nothing is in flight
                        time.sleep(0.05)
                        if self._should_complete_execution():
                            break
                    continue

            # Mark execution as complete
            self._execution_complete.set()

        except Exception as e:
            self._error = e
            self._execution_complete.set()

    def _process_event(self, event: GraphEngineEvent) -> None:
        """
        Process an event from a worker.

        Args:
            event: Event to process
        """
        with self._event_collector_lock:
            self._collected_events.append(event)

        if isinstance(event, BaseNodeEvent):
            node_id = event.node_id

            # Check if this is a response node
            if self.response_coordinator.is_response_node(node_id):
                # Handle response node events
                self.response_coordinator.on_edge_update(node_id)

            # Handle node completion - add successor nodes to ready queue
            from core.workflow.events import NodeRunSucceededEvent

            if isinstance(event, NodeRunSucceededEvent):
                self._enqueue_successor_nodes(node_id)

    def _enqueue_successor_nodes(self, completed_node_id: str) -> None:
        """
        Add successor nodes to the ready queue after a node completes.

        Args:
            completed_node_id: ID of the node that just completed
        """
        # Get outgoing edges from this node
        outgoing_edges = self.graph.out_edges.get(completed_node_id, [])

        for edge_id in outgoing_edges:
            edge = self.graph.edges.get(edge_id)
            if edge:
                # Add target node to ready queue
                self.ready_queue.put(edge.head)

    def _should_complete_execution(self) -> bool:
        """
        Check if execution should be considered complete.

        Returns:
            True if execution should complete
        """
        # Complete if both queues are empty (workers will be idle)
        # Note: Don't check worker.is_alive() since they're daemon threads
        return self.ready_queue.empty() and self.event_queue.empty()

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
