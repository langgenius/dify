"""
Worker - Thread implementation for queue-based node execution

Workers pull node IDs from the ready_queue, execute nodes, and push events
to the event_queue for the dispatcher to process.
"""

import contextvars
import queue
import threading
import time
from datetime import datetime
from typing import final
from uuid import uuid4

from flask import Flask
from typing_extensions import override

from core.workflow.enums import NodeType
from core.workflow.graph import Graph
from core.workflow.graph_events import GraphNodeEventBase, NodeRunFailedEvent
from core.workflow.nodes.base.node import Node
from libs.flask_utils import preserve_flask_contexts

from .ready_queue import ReadyQueue


@final
class Worker(threading.Thread):
    """
    Worker thread that executes nodes from the ready queue.

    Workers continuously pull node IDs from the ready_queue, execute the
    corresponding nodes, and push the resulting events to the event_queue
    for the dispatcher to process.
    """

    def __init__(
        self,
        ready_queue: ReadyQueue,
        event_queue: queue.Queue[GraphNodeEventBase],
        graph: Graph,
        worker_id: int = 0,
        flask_app: Flask | None = None,
        context_vars: contextvars.Context | None = None,
    ) -> None:
        """
        Initialize worker thread.

        Args:
            ready_queue: Ready queue containing node IDs ready for execution
            event_queue: Queue for pushing execution events
            graph: Graph containing nodes to execute
            worker_id: Unique identifier for this worker
            flask_app: Optional Flask application for context preservation
            context_vars: Optional context variables to preserve in worker thread
        """
        super().__init__(name=f"GraphWorker-{worker_id}", daemon=True)
        self._ready_queue = ready_queue
        self._event_queue = event_queue
        self._graph = graph
        self._worker_id = worker_id
        self._flask_app = flask_app
        self._context_vars = context_vars
        self._stop_event = threading.Event()
        self._last_task_time = time.time()

    def stop(self) -> None:
        """Signal the worker to stop processing."""
        self._stop_event.set()

    @property
    def is_idle(self) -> bool:
        """Check if the worker is currently idle."""
        # Worker is idle if it hasn't processed a task recently (within 0.2 seconds)
        return (time.time() - self._last_task_time) > 0.2

    @property
    def idle_duration(self) -> float:
        """Get the duration in seconds since the worker last processed a task."""
        return time.time() - self._last_task_time

    @property
    def worker_id(self) -> int:
        """Get the worker's ID."""
        return self._worker_id

    @override
    def run(self) -> None:
        """
        Main worker loop.

        Continuously pulls node IDs from ready_queue, executes them,
        and pushes events to event_queue until stopped.
        """
        while not self._stop_event.is_set():
            # Try to get a node ID from the ready queue (with timeout)
            try:
                node_id = self._ready_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            self._last_task_time = time.time()
            node = self._graph.nodes[node_id]
            try:
                self._execute_node(node)
                self._ready_queue.task_done()
            except Exception as e:
                error_event = NodeRunFailedEvent(
                    id=str(uuid4()),
                    node_id="unknown",
                    node_type=NodeType.CODE,
                    in_iteration_id=None,
                    error=str(e),
                    start_at=datetime.now(),
                )
                self._event_queue.put(error_event)

    def _execute_node(self, node: Node) -> None:
        """
        Execute a single node and handle its events.

        Args:
            node: The node instance to execute
        """
        # Execute the node with preserved context if Flask app is provided
        if self._flask_app and self._context_vars:
            with preserve_flask_contexts(
                flask_app=self._flask_app,
                context_vars=self._context_vars,
            ):
                # Execute the node
                node_events = node.run()
                for event in node_events:
                    # Forward event to dispatcher immediately for streaming
                    self._event_queue.put(event)
        else:
            # Execute without context preservation
            node_events = node.run()
            for event in node_events:
                # Forward event to dispatcher immediately for streaming
                self._event_queue.put(event)
