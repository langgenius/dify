"""
Enhanced worker pool with integrated activity tracking and dynamic scaling.

This is a proposed simplification that merges WorkerPool, ActivityTracker,
and DynamicScaler into a single cohesive class.
"""

import queue
import threading
import time
from typing import TYPE_CHECKING, final

from configs import dify_config
from core.workflow.graph import Graph
from core.workflow.graph_events import GraphNodeEventBase

from ..worker import Worker

if TYPE_CHECKING:
    from contextvars import Context

    from flask import Flask


@final
class EnhancedWorkerPool:
    """
    Enhanced worker pool with integrated features.

    This class combines the responsibilities of:
    - WorkerPool: Managing worker threads
    - ActivityTracker: Tracking worker activity
    - DynamicScaler: Making scaling decisions

    Benefits:
    - Simplified interface with fewer classes
    - Direct integration of related features
    - Reduced inter-class communication overhead
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
        Initialize the enhanced worker pool.

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
        self.ready_queue = ready_queue
        self.event_queue = event_queue
        self.graph = graph
        self.flask_app = flask_app
        self.context_vars = context_vars

        # Scaling parameters
        self.min_workers = min_workers or dify_config.GRAPH_ENGINE_MIN_WORKERS
        self.max_workers = max_workers or dify_config.GRAPH_ENGINE_MAX_WORKERS
        self.scale_up_threshold = scale_up_threshold or dify_config.GRAPH_ENGINE_SCALE_UP_THRESHOLD
        self.scale_down_idle_time = scale_down_idle_time or dify_config.GRAPH_ENGINE_SCALE_DOWN_IDLE_TIME

        # Worker management
        self.workers: list[Worker] = []
        self._worker_counter = 0
        self._lock = threading.RLock()
        self._running = False

        # Activity tracking (integrated)
        self._worker_activity: dict[int, tuple[bool, float]] = {}

        # Scaling control
        self._last_scale_check = time.time()
        self._scale_check_interval = 1.0  # Check scaling every second

    def start(self, initial_count: int | None = None) -> None:
        """
        Start the worker pool with initial workers.

        Args:
            initial_count: Number of workers to start with (auto-calculated if None)
        """
        with self._lock:
            if self._running:
                return

            self._running = True

            # Calculate initial worker count if not specified
            if initial_count is None:
                initial_count = self._calculate_initial_workers()

            # Create initial workers
            for _ in range(initial_count):
                self._add_worker()

    def stop(self) -> None:
        """Stop all workers in the pool."""
        with self._lock:
            self._running = False

            # Stop all workers
            for worker in self.workers:
                worker.stop()

            # Wait for workers to finish
            for worker in self.workers:
                if worker.is_alive():
                    worker.join(timeout=10.0)

            self.workers.clear()
            self._worker_activity.clear()

    def check_and_scale(self) -> None:
        """
        Check and perform scaling if needed.

        This method should be called periodically to adjust pool size.
        """
        current_time = time.time()

        # Rate limit scaling checks
        if current_time - self._last_scale_check < self._scale_check_interval:
            return

        self._last_scale_check = current_time

        with self._lock:
            if not self._running:
                return

            current_count = len(self.workers)
            queue_depth = self.ready_queue.qsize()

            # Check for scale up
            if self._should_scale_up(current_count, queue_depth):
                self._add_worker()

            # Check for scale down
            idle_workers = self._get_idle_workers(current_time)
            if idle_workers and self._should_scale_down(current_count):
                # Remove the most idle worker
                self._remove_worker(idle_workers[0])

    # ============= Private Methods =============

    def _calculate_initial_workers(self) -> int:
        """
        Calculate initial number of workers based on graph complexity.

        Returns:
            Initial worker count
        """
        # Simple heuristic: start with min_workers, scale based on graph size
        node_count = len(self.graph.nodes)

        if node_count < 10:
            return self.min_workers
        elif node_count < 50:
            return min(self.min_workers + 1, self.max_workers)
        else:
            return min(self.min_workers + 2, self.max_workers)

    def _should_scale_up(self, current_count: int, queue_depth: int) -> bool:
        """
        Determine if pool should scale up.

        Args:
            current_count: Current number of workers
            queue_depth: Current queue depth

        Returns:
            True if should scale up
        """
        if current_count >= self.max_workers:
            return False

        # Scale up if queue is deep
        if queue_depth > self.scale_up_threshold:
            return True

        # Scale up if all workers are busy and queue is not empty
        active_count = self._get_active_count()
        if active_count == current_count and queue_depth > 0:
            return True

        return False

    def _should_scale_down(self, current_count: int) -> bool:
        """
        Determine if pool should scale down.

        Args:
            current_count: Current number of workers

        Returns:
            True if should scale down
        """
        return current_count > self.min_workers

    def _add_worker(self) -> None:
        """Add a new worker to the pool."""
        worker_id = self._worker_counter
        self._worker_counter += 1

        # Create worker with activity callbacks
        worker = Worker(
            ready_queue=self.ready_queue,
            event_queue=self.event_queue,
            graph=self.graph,
            worker_id=worker_id,
            flask_app=self.flask_app,
            context_vars=self.context_vars,
            on_idle_callback=self._on_worker_idle,
            on_active_callback=self._on_worker_active,
        )

        worker.start()
        self.workers.append(worker)
        self._worker_activity[worker_id] = (False, time.time())

    def _remove_worker(self, worker_id: int) -> None:
        """
        Remove a specific worker from the pool.

        Args:
            worker_id: ID of worker to remove
        """
        worker_to_remove = None
        for worker in self.workers:
            if worker.worker_id == worker_id:
                worker_to_remove = worker
                break

        if worker_to_remove:
            worker_to_remove.stop()
            self.workers.remove(worker_to_remove)
            self._worker_activity.pop(worker_id, None)

            if worker_to_remove.is_alive():
                worker_to_remove.join(timeout=1.0)

    def _on_worker_idle(self, worker_id: int) -> None:
        """
        Callback when worker becomes idle.

        Args:
            worker_id: ID of the idle worker
        """
        with self._lock:
            self._worker_activity[worker_id] = (False, time.time())

    def _on_worker_active(self, worker_id: int) -> None:
        """
        Callback when worker becomes active.

        Args:
            worker_id: ID of the active worker
        """
        with self._lock:
            self._worker_activity[worker_id] = (True, time.time())

    def _get_idle_workers(self, current_time: float) -> list[int]:
        """
        Get list of workers that have been idle too long.

        Args:
            current_time: Current timestamp

        Returns:
            List of idle worker IDs sorted by idle time (longest first)
        """
        idle_workers: list[tuple[int, float]] = []

        for worker_id, (is_active, last_change) in self._worker_activity.items():
            if not is_active:
                idle_time = current_time - last_change
                if idle_time > self.scale_down_idle_time:
                    idle_workers.append((worker_id, idle_time))

        # Sort by idle time (longest first)
        idle_workers.sort(key=lambda x: x[1], reverse=True)
        return [worker_id for worker_id, _ in idle_workers]

    def _get_active_count(self) -> int:
        """
        Get count of currently active workers.

        Returns:
            Number of active workers
        """
        return sum(1 for is_active, _ in self._worker_activity.values() if is_active)

    # ============= Public Status Methods =============

    def get_worker_count(self) -> int:
        """Get current number of workers."""
        with self._lock:
            return len(self.workers)

    def get_status(self) -> dict[str, int]:
        """
        Get pool status information.

        Returns:
            Dictionary with status information
        """
        with self._lock:
            return {
                "total_workers": len(self.workers),
                "active_workers": self._get_active_count(),
                "idle_workers": len(self.workers) - self._get_active_count(),
                "queue_depth": self.ready_queue.qsize(),
                "min_workers": self.min_workers,
                "max_workers": self.max_workers,
            }

    # ============= Backward Compatibility =============

    def scale_up(self) -> None:
        """Compatibility method for manual scale up."""
        with self._lock:
            if self._running and len(self.workers) < self.max_workers:
                self._add_worker()

    def scale_down(self, worker_ids: list[int]) -> None:
        """Compatibility method for manual scale down."""
        with self._lock:
            if not self._running:
                return

            for worker_id in worker_ids:
                if len(self.workers) > self.min_workers:
                    self._remove_worker(worker_id)

    def check_scaling(self, queue_depth: int, executing_count: int) -> None:
        """
        Compatibility method for checking scaling.

        Args:
            queue_depth: Current queue depth (ignored, we check directly)
            executing_count: Number of executing nodes (ignored)
        """
        self.check_and_scale()
