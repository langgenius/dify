"""
Simple worker pool that consolidates functionality.

This is a simpler implementation that merges WorkerPool, ActivityTracker,
DynamicScaler, and WorkerFactory into a single class.
"""

import queue
import threading
from typing import TYPE_CHECKING, final

from configs import dify_config
from core.workflow.graph import Graph
from core.workflow.graph_events import GraphNodeEventBase

from ..worker import Worker

if TYPE_CHECKING:
    from contextvars import Context

    from flask import Flask


@final
class SimpleWorkerPool:
    """
    Simple worker pool with integrated management.

    This class consolidates all worker management functionality into
    a single, simpler implementation without excessive abstraction.
    """

    def __init__(
        self,
        ready_queue: queue.Queue[str],
        event_queue: queue.Queue[GraphNodeEventBase],
        graph: Graph,
        flask_app: "Flask | None" = None,
        context_vars: "Context | None" = None,
        min_workers: int | None = None,
        max_workers: int | None = None,
        scale_up_threshold: int | None = None,
        scale_down_idle_time: float | None = None,
    ) -> None:
        """
        Initialize the simple worker pool.

        Args:
            ready_queue: Queue of nodes ready for execution
            event_queue: Queue for worker events
            graph: The workflow graph
            flask_app: Optional Flask app for context preservation
            context_vars: Optional context variables
            min_workers: Minimum number of workers
            max_workers: Maximum number of workers
            scale_up_threshold: Queue depth to trigger scale up
            scale_down_idle_time: Seconds before scaling down idle workers
        """
        self._ready_queue = ready_queue
        self._event_queue = event_queue
        self._graph = graph
        self._flask_app = flask_app
        self._context_vars = context_vars

        # Scaling parameters with defaults
        self._min_workers = min_workers or dify_config.GRAPH_ENGINE_MIN_WORKERS
        self._max_workers = max_workers or dify_config.GRAPH_ENGINE_MAX_WORKERS
        self._scale_up_threshold = scale_up_threshold or dify_config.GRAPH_ENGINE_SCALE_UP_THRESHOLD
        self._scale_down_idle_time = scale_down_idle_time or dify_config.GRAPH_ENGINE_SCALE_DOWN_IDLE_TIME

        # Worker management
        self._workers: list[Worker] = []
        self._worker_counter = 0
        self._lock = threading.RLock()
        self._running = False

    def start(self, initial_count: int | None = None) -> None:
        """
        Start the worker pool.

        Args:
            initial_count: Number of workers to start with (auto-calculated if None)
        """
        with self._lock:
            if self._running:
                return

            self._running = True

            # Calculate initial worker count
            if initial_count is None:
                node_count = len(self._graph.nodes)
                if node_count < 10:
                    initial_count = self._min_workers
                elif node_count < 50:
                    initial_count = min(self._min_workers + 1, self._max_workers)
                else:
                    initial_count = min(self._min_workers + 2, self._max_workers)

            # Create initial workers
            for _ in range(initial_count):
                self._create_worker()

    def stop(self) -> None:
        """Stop all workers in the pool."""
        with self._lock:
            self._running = False

            # Stop all workers
            for worker in self._workers:
                worker.stop()

            # Wait for workers to finish
            for worker in self._workers:
                if worker.is_alive():
                    worker.join(timeout=10.0)

            self._workers.clear()

    def _create_worker(self) -> None:
        """Create and start a new worker."""
        worker_id = self._worker_counter
        self._worker_counter += 1

        worker = Worker(
            ready_queue=self._ready_queue,
            event_queue=self._event_queue,
            graph=self._graph,
            worker_id=worker_id,
            flask_app=self._flask_app,
            context_vars=self._context_vars,
        )

        worker.start()
        self._workers.append(worker)

    def check_and_scale(self) -> None:
        """Check and perform scaling if needed."""
        with self._lock:
            if not self._running:
                return

            current_count = len(self._workers)
            queue_depth = self._ready_queue.qsize()

            # Simple scaling logic
            if queue_depth > self._scale_up_threshold and current_count < self._max_workers:
                self._create_worker()

    def get_worker_count(self) -> int:
        """Get current number of workers."""
        with self._lock:
            return len(self._workers)

    def get_status(self) -> dict[str, int]:
        """
        Get pool status information.

        Returns:
            Dictionary with status information
        """
        with self._lock:
            return {
                "total_workers": len(self._workers),
                "queue_depth": self._ready_queue.qsize(),
                "min_workers": self._min_workers,
                "max_workers": self._max_workers,
            }
