"""
Dynamic scaler for worker pool sizing.
"""

from typing import final

from core.workflow.graph import Graph


@final
class DynamicScaler:
    """
    Manages dynamic scaling decisions for the worker pool.

    This encapsulates the logic for when to scale up or down
    based on workload and configuration.
    """

    def __init__(
        self,
        min_workers: int = 2,
        max_workers: int = 10,
        scale_up_threshold: int = 5,
        scale_down_idle_time: float = 30.0,
    ) -> None:
        """
        Initialize the dynamic scaler.

        Args:
            min_workers: Minimum number of workers
            max_workers: Maximum number of workers
            scale_up_threshold: Queue depth to trigger scale up
            scale_down_idle_time: Idle time before scaling down
        """
        self.min_workers = min_workers
        self.max_workers = max_workers
        self.scale_up_threshold = scale_up_threshold
        self.scale_down_idle_time = scale_down_idle_time

    def calculate_initial_workers(self, graph: Graph) -> int:
        """
        Calculate initial worker count based on graph complexity.

        Args:
            graph: The workflow graph

        Returns:
            Initial number of workers to create
        """
        node_count = len(graph.nodes)

        # Simple heuristic: more nodes = more workers
        if node_count < 10:
            initial = self.min_workers
        elif node_count < 50:
            initial = min(4, self.max_workers)
        elif node_count < 100:
            initial = min(6, self.max_workers)
        else:
            initial = min(8, self.max_workers)

        return max(self.min_workers, initial)

    def should_scale_up(self, current_workers: int, queue_depth: int, executing_count: int) -> bool:
        """
        Determine if scaling up is needed.

        Args:
            current_workers: Current number of workers
            queue_depth: Number of nodes waiting
            executing_count: Number of nodes executing

        Returns:
            True if should scale up
        """
        if current_workers >= self.max_workers:
            return False

        # Scale up if queue is deep and workers are busy
        if queue_depth > self.scale_up_threshold:
            if executing_count >= current_workers * 0.8:
                return True

        return False

    def should_scale_down(self, current_workers: int, idle_workers: list[int]) -> bool:
        """
        Determine if scaling down is appropriate.

        Args:
            current_workers: Current number of workers
            idle_workers: List of idle worker IDs

        Returns:
            True if should scale down
        """
        if current_workers <= self.min_workers:
            return False

        # Scale down if we have idle workers
        return len(idle_workers) > 0
