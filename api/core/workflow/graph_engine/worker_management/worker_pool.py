"""
Worker pool management.
"""

import queue
import threading
from typing import final

from core.workflow.graph import Graph
from core.workflow.graph_events import GraphNodeEventBase

from ..worker import Worker
from .activity_tracker import ActivityTracker
from .dynamic_scaler import DynamicScaler
from .worker_factory import WorkerFactory


@final
class WorkerPool:
    """
    Manages a pool of worker threads for executing nodes.

    This provides dynamic scaling, activity tracking, and lifecycle
    management for worker threads.
    """

    def __init__(
        self,
        ready_queue: queue.Queue[str],
        event_queue: queue.Queue[GraphNodeEventBase],
        graph: Graph,
        worker_factory: WorkerFactory,
        dynamic_scaler: DynamicScaler,
        activity_tracker: ActivityTracker,
    ) -> None:
        """
        Initialize the worker pool.

        Args:
            ready_queue: Queue of nodes ready for execution
            event_queue: Queue for worker events
            graph: The workflow graph
            worker_factory: Factory for creating workers
            dynamic_scaler: Scaler for dynamic sizing
            activity_tracker: Tracker for worker activity
        """
        self.ready_queue = ready_queue
        self.event_queue = event_queue
        self.graph = graph
        self.worker_factory = worker_factory
        self.dynamic_scaler = dynamic_scaler
        self.activity_tracker = activity_tracker

        self.workers: list[Worker] = []
        self._lock = threading.RLock()
        self._running = False

    def start(self, initial_count: int) -> None:
        """
        Start the worker pool with initial workers.

        Args:
            initial_count: Number of workers to start with
        """
        with self._lock:
            if self._running:
                return

            self._running = True

            # Create initial workers
            for _ in range(initial_count):
                worker = self.worker_factory.create_worker(self.ready_queue, self.event_queue, self.graph)
                worker.start()
                self.workers.append(worker)

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

    def scale_up(self) -> None:
        """Add a worker to the pool if allowed."""
        with self._lock:
            if not self._running:
                return

            if len(self.workers) >= self.dynamic_scaler.max_workers:
                return

            worker = self.worker_factory.create_worker(self.ready_queue, self.event_queue, self.graph)
            worker.start()
            self.workers.append(worker)

    def scale_down(self, worker_ids: list[int]) -> None:
        """
        Remove specific workers from the pool.

        Args:
            worker_ids: IDs of workers to remove
        """
        with self._lock:
            if not self._running:
                return

            if len(self.workers) <= self.dynamic_scaler.min_workers:
                return

            workers_to_remove = [w for w in self.workers if w.worker_id in worker_ids]

            for worker in workers_to_remove:
                worker.stop()
                self.workers.remove(worker)
                if worker.is_alive():
                    worker.join(timeout=1.0)

    def get_worker_count(self) -> int:
        """Get current number of workers."""
        with self._lock:
            return len(self.workers)

    def check_scaling(self, queue_depth: int, executing_count: int) -> None:
        """
        Check and perform scaling if needed.

        Args:
            queue_depth: Current queue depth
            executing_count: Number of executing nodes
        """
        current_count = self.get_worker_count()

        if self.dynamic_scaler.should_scale_up(current_count, queue_depth, executing_count):
            self.scale_up()

        idle_workers = self.activity_tracker.get_idle_workers()
        if idle_workers:
            self.scale_down(idle_workers)
