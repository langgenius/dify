from __future__ import annotations

from queue import Empty
from unittest.mock import patch

import pytest

from core.app.apps.workflow.stop_aware_ready_queue import (
    StopAwareReadyQueue,
    attach_stop_aware_ready_queue,
)
from graphon.engine.ready_queue import StartTask
from graphon.runtime import RuntimeState, VariablePool
from graphon.runtime.execution import GraphExecution
from graphon.runtime.ready_queue.in_memory import InMemoryReadyQueue


def _start_task(node_id: str = "next-node") -> StartTask:
    return StartTask(frame_id="root", node_id=node_id)


def _graph_execution(*, aborted: bool = False) -> GraphExecution:
    return GraphExecution(workflow_id="workflow-1", aborted=aborted)


def test_ready_queue_accepts_work_while_run_is_active() -> None:
    inner = InMemoryReadyQueue()
    queue = StopAwareReadyQueue(inner, task_id="task-1", graph_execution=_graph_execution())
    task = _start_task()

    with patch(
        "core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set",
        return_value=False,
    ):
        queue.put(task)

    assert inner.get(timeout=0.01) is task
    inner.task_done()


def test_ready_queue_rejects_next_node_after_graph_abort() -> None:
    inner = InMemoryReadyQueue()
    queue = StopAwareReadyQueue(inner, task_id="task-1", graph_execution=_graph_execution(aborted=True))

    with patch(
        "core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set",
        return_value=False,
    ):
        queue.put(_start_task())

    assert inner.qsize() == 0


def test_ready_queue_rejects_next_node_when_stop_flag_is_set() -> None:
    inner = InMemoryReadyQueue()
    queue = StopAwareReadyQueue(inner, task_id="task-1", graph_execution=_graph_execution())

    with patch(
        "core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set",
        return_value=True,
    ):
        queue.put(_start_task("code-node"))

    assert inner.qsize() == 0


@pytest.mark.parametrize(
    ("aborted", "stop_flag_is_set"),
    [(True, False), (False, True)],
    ids=["graph-aborted", "user-stop-flag"],
)
def test_ready_queue_drops_pending_work_after_stop(
    aborted: bool,
    stop_flag_is_set: bool,
) -> None:
    inner = InMemoryReadyQueue()
    inner.put(_start_task("already-queued-node"))
    queue = StopAwareReadyQueue(
        inner,
        task_id="task-1",
        graph_execution=_graph_execution(aborted=aborted),
    )

    with (
        patch(
            "core.app.apps.workflow.stop_aware_ready_queue.is_app_task_stop_flag_set",
            return_value=stop_flag_is_set,
        ),
        pytest.raises(Empty),
    ):
        queue.get(timeout=0.01)

    with pytest.raises(ValueError, match=r"task_done\(\) called too many times"):
        inner.task_done()


def test_attach_stop_aware_ready_queue_wraps_once() -> None:
    inner = InMemoryReadyQueue()
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
