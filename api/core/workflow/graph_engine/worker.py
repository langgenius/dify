"""
Worker - Thread implementation for queue-based node execution

Workers pull node IDs from the ready_queue, execute nodes, and push events
to the event_queue for the dispatcher to process.
"""

import contextvars
import queue
import threading
import time
from collections.abc import Sequence
from datetime import datetime
from typing import final
from uuid import uuid4

from flask import Flask
from typing_extensions import override

from core.workflow.graph import Graph
from core.workflow.graph_engine.layers.base import GraphEngineLayer
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
        layers: Sequence[GraphEngineLayer],
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
            layers: Graph engine layers for node execution hooks
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
        self._layers = layers if layers is not None else []

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
                    node_id=node.id,
                    node_type=node.node_type,
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
        node.ensure_execution_id()

        error: Exception | None = None

        if self._flask_app and self._context_vars:
            with preserve_flask_contexts(
                flask_app=self._flask_app,
                context_vars=self._context_vars,
            ):
                self._invoke_node_run_start_hooks(node)
                try:
                    node_events = node.run()
                    for event in node_events:
                        self._event_queue.put(event)
                except Exception as exc:
                    error = exc
                    raise
                finally:
                    self._invoke_node_run_end_hooks(node, error)
        else:
            self._invoke_node_run_start_hooks(node)
            try:
                node_events = node.run()
                for event in node_events:
                    self._event_queue.put(event)
            except Exception as exc:
                error = exc
                raise
            finally:
                self._invoke_node_run_end_hooks(node, error)

    def _invoke_node_run_start_hooks(self, node: Node) -> None:
        """Invoke on_node_run_start hooks for all layers."""
        for layer in self._layers:
            try:
                layer.on_node_run_start(node)
            except Exception:
                # Silently ignore layer errors to prevent disrupting node execution
                continue

    def _invoke_node_run_end_hooks(self, node: Node, error: Exception | None) -> None:
        """Invoke on_node_run_end hooks for all layers."""
        for layer in self._layers:
            try:
                layer.on_node_run_end(node, error)
            except Exception:
                # Silently ignore layer errors to prevent disrupting node execution
                continue
