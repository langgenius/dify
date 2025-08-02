"""
Worker - Thread implementation for queue-based node execution

Workers pull node IDs from the ready_queue, execute nodes, and push events
to the event_queue for the dispatcher to process.
"""

import queue
import threading
from uuid import uuid4

from core.workflow.events import (
    GraphEngineEvent,
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph.graph import Graph, Node
from core.workflow.graph_engine.output_registry import OutputRegistry


class Worker(threading.Thread):
    """
    Worker thread that executes nodes from the ready queue.

    Workers continuously pull node IDs from the ready_queue, execute the
    corresponding nodes, and push the resulting events to the event_queue
    for the dispatcher to process.
    """

    def __init__(
        self,
        ready_queue: queue.Queue[str],
        event_queue: queue.Queue[GraphEngineEvent],
        graph: Graph,
        output_registry: OutputRegistry,
        worker_id: int = 0,
    ) -> None:
        """
        Initialize worker thread.

        Args:
            ready_queue: Queue containing node IDs ready for execution
            event_queue: Queue for pushing execution events
            graph: Graph containing nodes to execute
            output_registry: Registry for storing node outputs
            worker_id: Unique identifier for this worker
        """
        super().__init__(name=f"GraphWorker-{worker_id}", daemon=True)
        self.ready_queue = ready_queue
        self.event_queue = event_queue
        self.graph = graph
        self.output_registry = output_registry
        self.worker_id = worker_id
        self._stop_event = threading.Event()

    def stop(self) -> None:
        """Signal the worker to stop processing."""
        self._stop_event.set()

    def run(self) -> None:
        """
        Main worker loop.

        Continuously pulls node IDs from ready_queue, executes them,
        and pushes events to event_queue until stopped.
        """
        while not self._stop_event.is_set():
            try:
                # Try to get a node ID from the ready queue (with timeout)
                try:
                    node_id = self.ready_queue.get(timeout=0.1)
                except queue.Empty:
                    continue

                # Get the node from the graph
                node = self.graph.get_node(node_id)
                if node is None:
                    # Push error event for missing node
                    from uuid import uuid4

                    from core.workflow.enums import NodeType

                    error_event = NodeRunFailedEvent(
                        id=str(uuid4()),
                        node_id=node_id,
                        node_type=NodeType.CODE,  # Default type
                        node_data={},
                        route_node_state={},
                        parallel_id=None,
                        in_iteration_id=None,
                        error=f"Node {node_id} not found in graph",
                    )
                    self.event_queue.put(error_event)
                    self.ready_queue.task_done()
                    continue

                # Execute the node
                self._execute_node(node)

                # Mark task as done
                self.ready_queue.task_done()

            except Exception as e:
                # Handle unexpected errors
                try:
                    from uuid import uuid4

                    from core.workflow.enums import NodeType

                    error_event = NodeRunFailedEvent(
                        id=str(uuid4()),
                        node_id="unknown",
                        node_type=NodeType.CODE,
                        node_data={},
                        route_node_state={},
                        parallel_id=None,
                        in_iteration_id=None,
                        error=str(e),
                    )
                    self.event_queue.put(error_event)
                except Exception:
                    # If we can't even create an error event, just continue
                    pass

    def _execute_node(self, node: Node) -> None:
        """
        Execute a single node and handle its events.

        Args:
            node: The node instance to execute
        """
        try:
            # Create and push start event with required fields
            start_event = NodeRunStartedEvent(
                id=str(uuid4()),  # Required: node execution id
                node_id=node.id,  # Required: node id
                node_type=node.type_,  # Required: node type enum
                node_data={},  # Required: node data
                route_node_state={},  # Required: route node state
                parallel_id=None,
                in_iteration_id=None,
            )
            self.event_queue.put(start_event)

            # Execute the node
            # Call the node's _run method (internal execution)
            node_events = node.run()

            # Process node events
            for event in node_events:
                # Store outputs in registry if available
                if hasattr(event, "outputs") and event.outputs:
                    for key, value in event.outputs.items():
                        self.output_registry.set_scalar([node.id, key], value)

                # Forward event to dispatcher
                self.event_queue.put(event)

            # Create and push success event
            success_event = NodeRunSucceededEvent(
                id=str(uuid4()),  # Required: node execution id
                node_id=node.id,  # Required: node id
                node_type=node.type_,  # Required: node type enum
                node_data={},  # Required: node data
                route_node_state={},  # Required: route node state
                parallel_id=None,
                in_iteration_id=None,
            )
            self.event_queue.put(success_event)

        except Exception as e:
            # Create and push failure event
            failure_event = NodeRunFailedEvent(
                id=str(uuid4()),  # Required: node execution id
                node_id=node.id,  # Required: node id
                node_type=node.type_,  # Required: node type enum
                node_data={},  # Required: node data
                route_node_state={},  # Required: route node state
                parallel_id=None,
                in_iteration_id=None,
                error=str(e),  # Convert exception to string
            )
            self.event_queue.put(failure_event)
