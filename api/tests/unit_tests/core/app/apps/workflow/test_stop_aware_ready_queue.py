from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock, patch

from core.app.apps.workflow.stop_aware_ready_queue import (
    StopAwareReadyQueue,
    attach_stop_aware_ready_queue,
)
from graphon.graph_engine.ready_queue import StartTask


def _start_task(node_id: str = "next-node") -> StartTask:
    return StartTask(frame_id="root", node_id=node_id)


def test_ready_queue_accepts_work_while_run_is_active() -> None:
    inner = Mock()
    queue = StopAwareReadyQueue(inner, task_id="task-1", graph_execution=SimpleNamespace(aborted=False))
    task = _start_task()

    with patch(
        "core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set",
        return_value=False,
    ):
        queue.put(task)

    inner.put.assert_called_once_with(task)


def test_ready_queue_rejects_next_node_after_graph_abort() -> None:
    inner = Mock()
    queue = StopAwareReadyQueue(inner, task_id="task-1", graph_execution=SimpleNamespace(aborted=True))

    with patch(
        "core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set",
        return_value=False,
    ):
        queue.put(_start_task())

    inner.put.assert_not_called()


def test_ready_queue_rejects_next_node_when_stop_flag_is_set() -> None:
    inner = Mock()
    queue = StopAwareReadyQueue(inner, task_id="task-1", graph_execution=SimpleNamespace(aborted=False))

    with patch(
        "core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set",
        return_value=True,
    ) as stop_flag:
        queue.put(_start_task("code-node"))

    stop_flag.assert_called_once_with("task-1")
    inner.put.assert_not_called()


class _RuntimeState:
    def __init__(self, ready_queue: object) -> None:
        self._ready_queue = ready_queue
        self.graph_execution = SimpleNamespace(aborted=False)

    @property
    def ready_queue(self) -> object:
        return self._ready_queue


def test_attach_stop_aware_ready_queue_wraps_once() -> None:
    inner = Mock()
    runtime_state = _RuntimeState(inner)

    attach_stop_aware_ready_queue(runtime_state, task_id="task-1")
    first = runtime_state.ready_queue
    attach_stop_aware_ready_queue(runtime_state, task_id="task-1")

    assert isinstance(first, StopAwareReadyQueue)
    assert runtime_state.ready_queue is first


def test_stop_aware_queue_delegates_reads() -> None:
    inner = Mock()
    inner.get.return_value = _start_task("queued")
    inner.qsize.return_value = 1
    inner.drain.return_value = [_start_task("queued")]
    inner.dumps.return_value = "{}"
    queue = StopAwareReadyQueue(inner, task_id="task-1", graph_execution=SimpleNamespace(aborted=False))

    assert queue.get(timeout=0.1).node_id == "queued"
    queue.task_done()
    assert queue.qsize() == 1
    assert queue.drain()[0].node_id == "queued"
    assert queue.dumps() == "{}"
    queue.loads("{}")

    inner.get.assert_called_once_with(timeout=0.1)
    inner.task_done.assert_called_once()
    inner.loads.assert_called_once_with("{}")
