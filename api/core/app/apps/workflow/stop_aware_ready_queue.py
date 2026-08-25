"""Ready-queue wrapper that honors stop before the next node is scheduled."""

from __future__ import annotations

from typing import final

from core.app.apps.execution_coordinator import is_app_task_stop_flag_set
from graphon.engine.ready_queue import ReadyTask
from graphon.runtime import RuntimeState
from graphon.runtime.execution import GraphExecution
from graphon.runtime.ready_queue import ReadyQueue


@final
class StopAwareReadyQueue:
    """Reject newly ready nodes once the run has been stopped.

    GraphEngine drain still enqueues successors after abort. Drop those puts so
    later nodes do not start; the in-flight node can finish.
    """

    def __init__(
        self,
        inner: ReadyQueue,
        *,
        task_id: str,
        graph_execution: GraphExecution,
    ) -> None:
        self._inner = inner
        self._task_id = task_id
        self._graph_execution = graph_execution

    def _should_reject(self) -> bool:
        return self._graph_execution.aborted or is_app_task_stop_flag_set(self._task_id)

    def put(self, item: ReadyTask) -> None:
        if self._should_reject():
            return
        self._inner.put(item)

    def get(self, timeout: float | None = None) -> ReadyTask:
        return self._inner.get(timeout=timeout)

    def task_done(self) -> None:
        self._inner.task_done()

    def qsize(self) -> int:
        return self._inner.qsize()

    def drain(self) -> list[ReadyTask]:
        return self._inner.drain()

    def dumps(self) -> str:
        return self._inner.dumps()

    def loads(self, data: str) -> None:
        self._inner.loads(data)


def attach_stop_aware_ready_queue(graph_runtime_state: RuntimeState, *, task_id: str) -> None:
    """Install stop-aware enqueue policy on an existing runtime state."""
    current = graph_runtime_state.ready_queue
    if isinstance(current, StopAwareReadyQueue):
        return
    graph_runtime_state._ready_queue = StopAwareReadyQueue(
        current,
        task_id=task_id,
        graph_execution=graph_runtime_state.graph_execution,
    )
