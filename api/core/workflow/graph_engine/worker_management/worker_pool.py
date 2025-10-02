"""
Simple worker pool that consolidates functionality.

This is a simpler implementation that merges WorkerPool, ActivityTracker,
DynamicScaler, and WorkerFactory into a single class.
"""

import logging
import queue
import threading
from typing import TYPE_CHECKING, final

from configs import dify_config
from core.workflow.graph import Graph
from core.workflow.graph_events import GraphNodeEventBase

from ..ready_queue import ReadyQueue
from ..worker import Worker

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from contextvars import Context

    from flask import Flask


@final
class WorkerPool:
    """
    Simple worker pool with integrated management.

    This class consolidates all worker management functionality into
    a single, simpler implementation without excessive abstraction.
    """

    def __init__(
        self,
        ready_queue: ReadyQueue,
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
            ready_queue: Ready queue for nodes ready for execution
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

        # No longer tracking worker states with callbacks to avoid lock contention

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

                logger.debug(
                    "Starting worker pool: %d workers (nodes=%d, min=%d, max=%d)",
                    initial_count,
                    node_count,
                    self._min_workers,
                    self._max_workers,
                )

            # Create initial workers
            for _ in range(initial_count):
                self._create_worker()

    def stop(self) -> None:
        """Stop all workers in the pool."""
        with self._lock:
            self._running = False
            worker_count = len(self._workers)

            if worker_count > 0:
                logger.debug("Stopping worker pool: %d workers", worker_count)

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

    def _remove_worker(self, worker: Worker, worker_id: int) -> None:
        """Remove a specific worker from the pool."""
        # Stop the worker
        worker.stop()

        # Wait for it to finish
        if worker.is_alive():
            worker.join(timeout=2.0)

        # Remove from list
        if worker in self._workers:
            self._workers.remove(worker)

    def _try_scale_up(self, queue_depth: int, current_count: int) -> bool:
        """
        Try to scale up workers if needed.

        Args:
            queue_depth: Current queue depth
            current_count: Current number of workers

        Returns:
            True if scaled up, False otherwise
        """
        if queue_depth > self._scale_up_threshold and current_count < self._max_workers:
            old_count = current_count
            self._create_worker()

            logger.debug(
                "Scaled up workers: %d -> %d (queue_depth=%d exceeded threshold=%d)",
                old_count,
                len(self._workers),
                queue_depth,
                self._scale_up_threshold,
            )
            return True
        return False

    def _try_scale_down(self, queue_depth: int, current_count: int, active_count: int, idle_count: int) -> bool:
        """
        Try to scale down workers if we have excess capacity.

        Args:
            queue_depth: Current queue depth
            current_count: Current number of workers
            active_count: Number of active workers
            idle_count: Number of idle workers

        Returns:
            True if scaled down, False otherwise
        """
        # Skip if we're at minimum or have no idle workers
        if current_count <= self._min_workers or idle_count == 0:
            return False

        # Check if we have excess capacity
        has_excess_capacity = (
            queue_depth <= active_count  # Active workers can handle current queue
            or idle_count > active_count  # More idle than active workers
            or (queue_depth == 0 and idle_count > 0)  # No work and have idle workers
        )

        if not has_excess_capacity:
            return False

        # Find and remove idle workers that have been idle long enough
        workers_to_remove: list[tuple[Worker, int]] = []

        for worker in self._workers:
            # Check if worker is idle and has exceeded idle time threshold
            if worker.is_idle and worker.idle_duration >= self._scale_down_idle_time:
                # Don't remove if it would leave us unable to handle the queue
                remaining_workers = current_count - len(workers_to_remove) - 1
                if remaining_workers >= self._min_workers and remaining_workers >= max(1, queue_depth // 2):
                    workers_to_remove.append((worker, worker.worker_id))
                    # Only remove one worker per check to avoid aggressive scaling
                    break

        # Remove idle workers if any found
        if workers_to_remove:
            old_count = current_count
            for worker, worker_id in workers_to_remove:
                self._remove_worker(worker, worker_id)

            logger.debug(
                "Scaled down workers: %d -> %d (removed %d idle workers after %.1fs, "
                "queue_depth=%d, active=%d, idle=%d)",
                old_count,
                len(self._workers),
                len(workers_to_remove),
                self._scale_down_idle_time,
                queue_depth,
                active_count,
                idle_count - len(workers_to_remove),
            )
            return True

        return False

    def check_and_scale(self) -> None:
        """Check and perform scaling if needed."""
        with self._lock:
            if not self._running:
                return

            current_count = len(self._workers)
            queue_depth = self._ready_queue.qsize()

            # Count active vs idle workers by querying their state directly
            idle_count = sum(1 for worker in self._workers if worker.is_idle)
            active_count = current_count - idle_count

            # Try to scale up if queue is backing up
            self._try_scale_up(queue_depth, current_count)

            # Try to scale down if we have excess capacity
            self._try_scale_down(queue_depth, current_count, active_count, idle_count)

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
