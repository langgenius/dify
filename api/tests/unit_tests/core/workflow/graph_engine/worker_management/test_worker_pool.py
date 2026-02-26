from __future__ import annotations

import queue
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.workflow.graph_engine.config import GraphEngineConfig
from core.workflow.graph_engine.worker_management.worker_pool import WorkerPool


def _build_pool(
    *,
    node_count: int = 0,
    queue_depth: int = 0,
    config: GraphEngineConfig | None = None,
) -> tuple[WorkerPool, MagicMock]:
    ready_queue = MagicMock()
    ready_queue.qsize.return_value = queue_depth
    event_queue: queue.Queue = queue.Queue()
    graph = SimpleNamespace(nodes={f"node-{i}": object() for i in range(node_count)})
    pool = WorkerPool(
        ready_queue=ready_queue,
        event_queue=event_queue,
        graph=graph,
        layers=[],
        stop_event=threading.Event(),
        config=config or GraphEngineConfig(),
    )
    return pool, ready_queue


@pytest.mark.parametrize(
    ("node_count", "expected_count"),
    [
        (5, 1),  # < 10 -> min_workers
        (20, 2),  # < 50 -> min_workers + 1
        (100, 3),  # >= 50 -> min_workers + 2
    ],
)
def test_start_auto_calculates_worker_count(node_count: int, expected_count: int) -> None:
    config = GraphEngineConfig(min_workers=1, max_workers=3)
    pool, _ = _build_pool(node_count=node_count, config=config)
    pool._create_worker = MagicMock()

    pool.start()

    assert pool._running is True
    assert pool._create_worker.call_count == expected_count


def test_start_returns_early_when_pool_is_already_running() -> None:
    pool, _ = _build_pool()
    pool._running = True
    pool._create_worker = MagicMock()

    pool.start(initial_count=2)

    pool._create_worker.assert_not_called()


def test_stop_stops_joins_and_clears_workers() -> None:
    pool, _ = _build_pool()
    alive_worker = MagicMock()
    alive_worker.is_alive.return_value = True
    idle_worker = MagicMock()
    idle_worker.is_alive.return_value = False
    pool._workers = [alive_worker, idle_worker]
    pool._running = True

    pool.stop()

    assert pool._running is False
    alive_worker.stop.assert_called_once_with()
    idle_worker.stop.assert_called_once_with()
    alive_worker.join.assert_called_once_with(timeout=2.0)
    idle_worker.join.assert_not_called()
    assert pool._workers == []


def test_create_worker_constructs_and_starts_worker_instances() -> None:
    pool, _ = _build_pool()
    worker_1 = MagicMock()
    worker_2 = MagicMock()
    with patch(
        "core.workflow.graph_engine.worker_management.worker_pool.Worker",
        side_effect=[worker_1, worker_2],
    ) as worker_cls:
        pool._create_worker()
        pool._create_worker()

    assert pool._worker_counter == 2
    assert pool._workers == [worker_1, worker_2]
    worker_1.start.assert_called_once_with()
    worker_2.start.assert_called_once_with()
    assert worker_cls.call_args_list[0].kwargs["worker_id"] == 0
    assert worker_cls.call_args_list[1].kwargs["worker_id"] == 1
    assert worker_cls.call_args_list[0].kwargs["stop_event"] is pool._stop_event


def test_remove_worker_stops_joins_and_removes_worker() -> None:
    pool, _ = _build_pool()
    worker = MagicMock()
    worker.is_alive.return_value = True
    pool._workers = [worker]

    pool._remove_worker(worker, worker_id=3)

    worker.stop.assert_called_once_with()
    worker.join.assert_called_once_with(timeout=2.0)
    assert pool._workers == []


def test_try_scale_up_scales_when_queue_depth_exceeds_threshold() -> None:
    config = GraphEngineConfig(min_workers=1, max_workers=3, scale_up_threshold=2)
    pool, _ = _build_pool(config=config)
    pool._workers = [MagicMock()]
    pool._create_worker = MagicMock(side_effect=lambda: pool._workers.append(MagicMock()))

    scaled = pool._try_scale_up(queue_depth=3, current_count=1)

    assert scaled is True
    assert len(pool._workers) == 2
    pool._create_worker.assert_called_once_with()


def test_try_scale_up_returns_false_without_capacity_or_pressure() -> None:
    config = GraphEngineConfig(min_workers=1, max_workers=1, scale_up_threshold=2)
    pool, _ = _build_pool(config=config)
    pool._workers = [MagicMock()]
    pool._create_worker = MagicMock()

    assert pool._try_scale_up(queue_depth=10, current_count=1) is False
    assert pool._try_scale_up(queue_depth=1, current_count=0) is False
    pool._create_worker.assert_not_called()


def test_try_scale_down_returns_false_when_at_min_or_no_idle_workers() -> None:
    config = GraphEngineConfig(min_workers=1, max_workers=3, scale_down_idle_time=1.0)
    pool, _ = _build_pool(config=config)

    assert pool._try_scale_down(queue_depth=0, current_count=1, active_count=1, idle_count=0) is False
    assert pool._try_scale_down(queue_depth=0, current_count=2, active_count=2, idle_count=0) is False


def test_try_scale_down_removes_one_idle_worker_when_excess_capacity() -> None:
    config = GraphEngineConfig(min_workers=1, max_workers=3, scale_down_idle_time=1.0)
    pool, _ = _build_pool(config=config)
    active_worker = MagicMock(is_idle=False, idle_duration=0.2, worker_id=1)
    idle_worker = MagicMock(is_idle=True, idle_duration=5.0, worker_id=2)
    pool._workers = [active_worker, idle_worker]

    pool._remove_worker = MagicMock(side_effect=lambda worker, worker_id: pool._workers.remove(worker))
    scaled = pool._try_scale_down(queue_depth=0, current_count=2, active_count=1, idle_count=1)

    assert scaled is True
    pool._remove_worker.assert_called_once_with(idle_worker, 2)
    assert pool._workers == [active_worker]


def test_try_scale_down_returns_false_when_no_excess_capacity() -> None:
    config = GraphEngineConfig(min_workers=1, max_workers=3, scale_down_idle_time=1.0)
    pool, _ = _build_pool(config=config)
    idle_a = MagicMock(is_idle=True, idle_duration=5.0, worker_id=1)
    idle_b = MagicMock(is_idle=True, idle_duration=5.0, worker_id=2)
    pool._workers = [idle_a, idle_b]

    # queue_depth > active_count and idle_count == active_count (both 2 here via arguments) -> no excess capacity.
    scaled = pool._try_scale_down(queue_depth=5, current_count=2, active_count=2, idle_count=2)

    assert scaled is False


def test_check_and_scale_noops_when_pool_not_running() -> None:
    pool, _ = _build_pool()
    pool._running = False
    pool._try_scale_up = MagicMock()
    pool._try_scale_down = MagicMock()

    pool.check_and_scale()

    pool._try_scale_up.assert_not_called()
    pool._try_scale_down.assert_not_called()


def test_check_and_scale_calls_scale_methods_with_computed_counts() -> None:
    pool, _ = _build_pool(queue_depth=4)
    pool._running = True
    pool._workers = [
        MagicMock(is_idle=False, idle_duration=0.1, worker_id=1),
        MagicMock(is_idle=True, idle_duration=5.0, worker_id=2),
    ]
    pool._try_scale_up = MagicMock(return_value=False)
    pool._try_scale_down = MagicMock(return_value=False)

    pool.check_and_scale()

    pool._try_scale_up.assert_called_once_with(4, 2)
    pool._try_scale_down.assert_called_once_with(4, 2, 1, 1)


def test_get_worker_count_and_status_report_runtime_state() -> None:
    config = GraphEngineConfig(min_workers=1, max_workers=4)
    pool, ready_queue = _build_pool(queue_depth=3, config=config)
    pool._workers = [MagicMock(), MagicMock()]

    assert pool.get_worker_count() == 2
    assert pool.get_status() == {
        "total_workers": 2,
        "queue_depth": 3,
        "min_workers": 1,
        "max_workers": 4,
    }
    ready_queue.qsize.assert_called_once_with()
