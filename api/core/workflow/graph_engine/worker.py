"""
Worker - Thread implementation for queue-based node execution

Workers pull node IDs from the ready_queue, execute nodes, and push events
to the event_queue for the dispatcher to process.
"""

import queue
import threading
from datetime import datetime
from uuid import uuid4

from core.workflow.enums import NodeType
from core.workflow.events import GraphNodeEventBase, NodeRunFailedEvent
from core.workflow.graph.graph import Graph, Node


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
        event_queue: queue.Queue[GraphNodeEventBase],
        graph: Graph,
        worker_id: int = 0,
    ) -> None:
        """
        Initialize worker thread.

        Args:
            ready_queue: Queue containing node IDs ready for execution
            event_queue: Queue for pushing execution events
            graph: Graph containing nodes to execute
            worker_id: Unique identifier for this worker
        """
        super().__init__(name=f"GraphWorker-{worker_id}", daemon=True)
        self.ready_queue = ready_queue
        self.event_queue = event_queue
        self.graph = graph
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
            # Try to get a node ID from the ready queue (with timeout)
            try:
                node_id = self.ready_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            node = self.graph.nodes[node_id]
            try:
                self._execute_node(node)
                self.ready_queue.task_done()
            except Exception as e:
                # Handle unexpected errors
                try:
                    error_event = NodeRunFailedEvent(
                        id=str(uuid4()),
                        node_id="unknown",
                        node_type=NodeType.CODE,
                        in_iteration_id=None,
                        error=str(e),
                        start_at=datetime.now(),
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

        # Execute the node
        node_events = node.run()

        for event in node_events:
            # Forward event to dispatcher immediately for streaming
            self.event_queue.put(event)
