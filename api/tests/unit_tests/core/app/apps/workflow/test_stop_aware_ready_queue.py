from __future__ import annotations

from unittest.mock import Mock, patch

from core.app.apps.workflow.stop_aware_ready_queue import (
    StopAwareReadyQueue,
    attach_stop_aware_ready_queue,
)
from graphon.engine.ready_queue import StartTask
from graphon.runtime import RuntimeState, VariablePool
from graphon.runtime.execution import GraphExecution


def _start_task(node_id: str = "next-node") -> StartTask:
    return StartTask(frame_id="root", node_id=node_id)


def _graph_execution(*, aborted: bool = False) -> GraphExecution:
    return GraphExecution(workflow_id="workflow-1", aborted=aborted)


def test_ready_queue_accepts_work_while_run_is_active() -> None:
    inner = Mock()
    queue = StopAwareReadyQueue(inner, task_id="task-1", graph_execution=_graph_execution())
    task = _start_task()

    with patch(
        "core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set",
        return_value=False,
    ):
        queue.put(task)

    inner.put.assert_called_once_with(task)


def test_ready_queue_rejects_next_node_after_graph_abort() -> None:
    inner = Mock()
    queue = StopAwareReadyQueue(inner, task_id="task-1", graph_execution=_graph_execution(aborted=True))

    with patch(
        "core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set",
        return_value=False,
    ):
        queue.put(_start_task())

    inner.put.assert_not_called()


def test_ready_queue_rejects_next_node_when_stop_flag_is_set() -> None:
    inner = Mock()
    queue = StopAwareReadyQueue(inner, task_id="task-1", graph_execution=_graph_execution())

    with patch(
        "core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set",
        return_value=True,
    ) as stop_flag:
        queue.put(_start_task("code-node"))

    stop_flag.assert_called_once_with("task-1")
    inner.put.assert_not_called()


def test_attach_stop_aware_ready_queue_wraps_once() -> None:
    inner = Mock()
    runtime_state = RuntimeState(
        variable_pool=VariablePool(),
        start_at=0,
        ready_queue=inner,
        graph_execution=_graph_execution(),
    )

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
    queue = StopAwareReadyQueue(inner, task_id="task-1", graph_execution=_graph_execution())

    assert queue.get(timeout=0.1) == _start_task("queued")
    queue.task_done()
    assert queue.qsize() == 1
    assert queue.drain() == [_start_task("queued")]
    assert queue.dumps() == "{}"
    queue.loads("{}")

    inner.get.assert_called_once_with(timeout=0.1)
    inner.task_done.assert_called_once()
    inner.loads.assert_called_once_with("{}")
