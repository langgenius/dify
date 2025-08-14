"""
Tests for WorkerPoolManager - Dynamic worker management for GraphEngine
"""

import time
from unittest.mock import MagicMock

from core.workflow.graph import Graph
from core.workflow.graph_engine.worker_pool_manager import WorkerPoolManager


class TestWorkerPoolManager:
    """Test suite for WorkerPoolManager."""

    def test_calculate_initial_workers_sequential(self) -> None:
        """Test initial worker calculation for sequential graph."""
        manager = WorkerPoolManager(min_workers=1, max_workers=10)

        # Mock a sequential graph (no branches)
        graph = MagicMock(spec=Graph)
        graph.nodes = {"node1": MagicMock(), "node2": MagicMock(), "node3": MagicMock()}
        graph.get_outgoing_edges = MagicMock(return_value=[MagicMock()])  # Single edge
        graph.get_incoming_edges = MagicMock(return_value=[MagicMock()])  # Single edge

        initial_workers = manager.calculate_initial_workers(graph)
        assert initial_workers == 1  # Sequential flow needs minimal workers

    def test_calculate_initial_workers_parallel(self) -> None:
        """Test initial worker calculation for parallel graph."""
        manager = WorkerPoolManager(min_workers=1, max_workers=10)

        # Mock a graph with parallel branches
        graph = MagicMock(spec=Graph)
        graph.nodes = {
            "node1": MagicMock(),
            "node2": MagicMock(),
            "node3": MagicMock(),
            "node4": MagicMock(),
        }

        # Simulate branch node with 3 outgoing edges
        def get_outgoing_edges(node_id: str) -> list:
            if node_id == "node1":
                return [MagicMock(), MagicMock(), MagicMock()]  # 3 parallel branches
            return [MagicMock()]

        graph.get_outgoing_edges = MagicMock(side_effect=get_outgoing_edges)
        graph.get_incoming_edges = MagicMock(return_value=[MagicMock()])

        initial_workers = manager.calculate_initial_workers(graph)
        assert initial_workers >= 2  # Parallel flow needs more workers

    def test_calculate_initial_workers_respects_max(self) -> None:
        """Test that initial workers respects max_workers limit."""
        manager = WorkerPoolManager(min_workers=1, max_workers=2)

        # Mock a highly parallel graph
        graph = MagicMock(spec=Graph)
        graph.nodes = {f"node{i}": MagicMock() for i in range(20)}

        # Simulate many parallel branches
        graph.get_outgoing_edges = MagicMock(return_value=[MagicMock() for _ in range(10)])
        graph.get_incoming_edges = MagicMock(return_value=[MagicMock() for _ in range(5)])

        initial_workers = manager.calculate_initial_workers(graph)
        assert initial_workers <= 2  # Should not exceed max_workers

    def test_should_scale_up_queue_depth(self) -> None:
        """Test scale up decision based on queue depth."""
        manager = WorkerPoolManager(
            min_workers=1,
            max_workers=5,
            scale_up_threshold=3,
        )

        # Should scale up when queue depth exceeds threshold
        assert manager.should_scale_up(current_workers=2, queue_depth=4, executing_nodes=1) is True

        # Should not scale up when queue is below threshold
        assert manager.should_scale_up(current_workers=2, queue_depth=2, executing_nodes=1) is False

        # Should not scale up when at max workers
        assert manager.should_scale_up(current_workers=5, queue_depth=10, executing_nodes=5) is False

    def test_should_scale_up_all_busy(self) -> None:
        """Test scale up when all workers are busy."""
        manager = WorkerPoolManager(min_workers=1, max_workers=5)

        # Should scale up when all workers busy and queue has items
        assert manager.should_scale_up(current_workers=2, queue_depth=1, executing_nodes=2) is True

        # Should not scale up when workers are not all busy
        assert manager.should_scale_up(current_workers=3, queue_depth=1, executing_nodes=2) is False

    def test_should_scale_down(self) -> None:
        """Test scale down decision based on idle time."""
        manager = WorkerPoolManager(
            min_workers=1,
            max_workers=5,
            scale_down_idle_time=5.0,
        )

        current_time = time.time()

        # Should scale down when worker idle too long
        assert (
            manager.should_scale_down(
                current_workers=3,
                worker_id=1,
                last_task_time=current_time - 6.0,  # 6 seconds ago
            )
            is True
        )

        # Should not scale down when recently active
        assert (
            manager.should_scale_down(
                current_workers=3,
                worker_id=1,
                last_task_time=current_time - 2.0,  # 2 seconds ago
            )
            is False
        )

        # Should not scale down when at minimum workers
        assert (
            manager.should_scale_down(
                current_workers=1,
                worker_id=0,
                last_task_time=current_time - 10.0,  # Very idle
            )
            is False
        )

    def test_track_worker_activity(self) -> None:
        """Test worker activity tracking."""
        manager = WorkerPoolManager()

        # Track worker as idle
        manager.track_worker_activity(worker_id=1, is_active=False)
        assert 1 in manager._worker_idle_times

        # Track worker as active (should clear idle time)
        manager.track_worker_activity(worker_id=1, is_active=True)
        assert 1 not in manager._worker_idle_times

    def test_get_idle_workers(self) -> None:
        """Test getting list of idle workers."""
        manager = WorkerPoolManager(scale_down_idle_time=5.0)

        current_time = time.time()

        # Add some idle workers
        manager._worker_idle_times = {
            1: current_time - 6.0,  # Idle for 6 seconds
            2: current_time - 2.0,  # Idle for 2 seconds
            3: current_time - 10.0,  # Idle for 10 seconds
        }

        idle_workers = manager.get_idle_workers(current_time)
        assert 1 in idle_workers  # Idle > 5 seconds
        assert 2 not in idle_workers  # Idle < 5 seconds
        assert 3 in idle_workers  # Idle > 5 seconds

    def test_default_configuration(self) -> None:
        """Test creating manager with default configuration."""
        # Test that default values are sensible
        manager = WorkerPoolManager()

        # Should use default values
        assert manager.min_workers == 1
        assert manager.max_workers == 10
        assert manager.scale_up_threshold == 3
        assert manager.scale_down_idle_time == 5.0

    def test_configuration_validation(self) -> None:
        """Test that configuration is validated properly."""
        # Min workers should be at least 1
        manager = WorkerPoolManager(min_workers=0)
        assert manager.min_workers == 1

        # Max workers should not be less than min workers
        manager = WorkerPoolManager(min_workers=5, max_workers=3)
        assert manager.max_workers == 5
