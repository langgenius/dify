"""
Worker Pool Manager - Dynamic worker management for GraphEngine

This module provides intelligent worker pool sizing based on graph complexity
and runtime conditions, replacing the fixed 10-worker approach.
"""

import logging
import threading
import time
from typing import Optional

from core.workflow.graph import Graph

logger = logging.getLogger(__name__)


class WorkerPoolManager:
    """
    Manages dynamic worker pool sizing based on graph complexity and runtime metrics.

    Key features:
    - Calculates optimal worker count based on graph structure
    - Supports dynamic scaling during execution
    - Provides configuration-based limits
    """

    # Default configuration
    MIN_WORKERS = 1
    MAX_WORKERS = 10
    SCALE_UP_THRESHOLD = 3  # Queue depth to trigger scale up
    SCALE_DOWN_IDLE_TIME = 5.0  # Seconds of idle time before scaling down

    def __init__(
        self,
        min_workers: Optional[int] = None,
        max_workers: Optional[int] = None,
        scale_up_threshold: Optional[int] = None,
        scale_down_idle_time: Optional[float] = None,
    ) -> None:
        """
        Initialize the worker pool manager.

        Args:
            min_workers: Minimum number of workers (default: 1)
            max_workers: Maximum number of workers (default: 10)
            scale_up_threshold: Queue depth to trigger scale up (default: 3)
            scale_down_idle_time: Idle time before scaling down (default: 5.0s)
        """
        self.min_workers = min_workers or self.MIN_WORKERS
        self.max_workers = max_workers or self.MAX_WORKERS
        self.scale_up_threshold = scale_up_threshold or self.SCALE_UP_THRESHOLD
        self.scale_down_idle_time = scale_down_idle_time or self.SCALE_DOWN_IDLE_TIME

        # Ensure valid configuration
        if self.min_workers < 1:
            self.min_workers = 1
        if self.max_workers < self.min_workers:
            self.max_workers = self.min_workers

        # Runtime state
        self._lock = threading.RLock()
        self._worker_idle_times: dict[int, float] = {}

    def calculate_initial_workers(self, graph: Graph) -> int:
        """
        Calculate the initial number of workers based on graph complexity.

        Analyzes the graph structure to determine parallelism potential:
        - Sequential graphs: minimal workers
        - Graphs with parallel branches: more workers
        - Graphs with loops/iterations: moderate workers

        Args:
            graph: The workflow graph to analyze

        Returns:
            Optimal initial worker count
        """
        # Start with minimum
        initial_workers = self.min_workers

        # Analyze graph for parallelism potential
        parallelism_score = self._analyze_graph_parallelism(graph)

        # Calculate workers based on parallelism
        if parallelism_score <= 1:
            # Sequential flow
            initial_workers = self.min_workers
        elif parallelism_score <= 3:
            # Limited parallelism
            initial_workers = min(2, self.max_workers)
        elif parallelism_score <= 5:
            # Moderate parallelism
            initial_workers = min(3, self.max_workers)
        else:
            # High parallelism
            initial_workers = min(5, self.max_workers)

        logger.debug(
            "Calculated initial workers: %d (parallelism_score: %d, min: %d, max: %d)",
            initial_workers,
            parallelism_score,
            self.min_workers,
            self.max_workers,
        )

        return initial_workers

    def _analyze_graph_parallelism(self, graph: Graph) -> int:
        """
        Analyze graph structure to determine parallelism potential.

        Args:
            graph: The workflow graph to analyze

        Returns:
            Parallelism score (higher = more parallel potential)
        """
        parallelism_score = 1

        # Count nodes with multiple outgoing edges (potential parallel branches)
        for node_id, node in graph.nodes.items():
            outgoing_edges = graph.get_outgoing_edges(node_id)
            if len(outgoing_edges) > 1:
                # Branch node creates parallelism
                parallelism_score += len(outgoing_edges) - 1

        # Count nodes with multiple incoming edges (join points)
        for node_id in graph.nodes:
            incoming_edges = graph.get_incoming_edges(node_id)
            if len(incoming_edges) > 1:
                # Join node indicates previous parallelism
                parallelism_score += 1

        # Check for loop/iteration nodes (moderate parallelism)
        for node in graph.nodes.values():
            node_type = getattr(node, "type", None)
            if node_type in ["iteration", "loop"]:
                parallelism_score += 2

        return parallelism_score

    def should_scale_up(
        self,
        current_workers: int,
        queue_depth: int,
        executing_nodes: int,
    ) -> bool:
        """
        Determine if worker pool should scale up.

        Args:
            current_workers: Current number of workers
            queue_depth: Current ready queue depth
            executing_nodes: Number of nodes currently executing

        Returns:
            True if should add more workers
        """
        if current_workers >= self.max_workers:
            return False

        # Scale up if queue is backing up
        if queue_depth >= self.scale_up_threshold:
            return True

        # Scale up if all workers are busy and queue has items
        if executing_nodes >= current_workers and queue_depth > 0:
            return True

        return False

    def should_scale_down(
        self,
        current_workers: int,
        worker_id: int,
        last_task_time: float,
    ) -> bool:
        """
        Determine if a specific worker should be removed due to idleness.

        Args:
            current_workers: Current number of workers
            worker_id: ID of the worker to check
            last_task_time: Time when worker last processed a task

        Returns:
            True if worker should be removed
        """
        # Keep worker_id parameter for future use (per-worker policies)
        _ = worker_id

        if current_workers <= self.min_workers:
            return False

        # Check if worker has been idle too long
        idle_time = time.time() - last_task_time
        return idle_time > self.scale_down_idle_time

    def track_worker_activity(self, worker_id: int, is_active: bool) -> None:
        """
        Track worker activity for scaling decisions.

        Args:
            worker_id: ID of the worker
            is_active: True if worker just became active, False if idle
        """
        with self._lock:
            if is_active:
                # Worker is active, clear idle time
                self._worker_idle_times.pop(worker_id, None)
            else:
                # Worker is idle, record time if not already tracked
                if worker_id not in self._worker_idle_times:
                    self._worker_idle_times[worker_id] = time.time()

    def get_idle_workers(self, current_time: Optional[float] = None) -> list[int]:
        """
        Get list of workers that have been idle too long.

        Args:
            current_time: Current time (for testing), defaults to time.time()

        Returns:
            List of worker IDs that should be removed
        """
        if current_time is None:
            current_time = time.time()

        idle_workers = []
        with self._lock:
            for worker_id, idle_start in self._worker_idle_times.items():
                if current_time - idle_start > self.scale_down_idle_time:
                    idle_workers.append(worker_id)

        return idle_workers
