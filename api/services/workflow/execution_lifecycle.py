"""Host execution scopes and the post-filter pause persistence boundary."""

import logging
from collections.abc import Callable, Generator, Iterable, Sequence
from contextlib import contextmanager
from typing import override

from context import capture_current_context
from graphon.engine.layer import Layer
from graphon.engine_events import EngineEvent, GraphRunPausedEvent
from graphon.file.runtime import peek_workflow_file_runtime, use_workflow_file_runtime
from graphon.nodes.base.node import Node

logger = logging.getLogger(__name__)


class WorkflowExecutionContextLayer(Layer):
    """Restore host context separately for every worker segment, including resumes."""

    def __init__(self) -> None:
        super().__init__()
        self._context = capture_current_context()

    @contextmanager
    @override
    def node_run_context(self, node: Node, *, parent_execution_id: str | None = None) -> Generator[None]:
        file_runtime = peek_workflow_file_runtime()
        with self._context, use_workflow_file_runtime(file_runtime):
            yield


class WorkflowDebugLayer(Layer):
    @override
    def on_event(self, event: EngineEvent) -> None:
        logger.debug("Workflow event %s", event)


def settled_workflow_events(
    events: Iterable[EngineEvent],
    *,
    pause_callbacks: Sequence[Callable[[], None]],
    pause_failure_callbacks: Sequence[Callable[[Exception], None]] = (),
) -> Generator[EngineEvent]:
    """Expose paused only after engine quiescence, filter flush, and durable persistence.

    Callbacks execute outside Graphon's isolated layer hooks so persistence failures
    reach the host runner. Closing a partially consumed stream never checkpoints it.
    """
    paused: GraphRunPausedEvent | None = None
    for event in events:
        if isinstance(event, GraphRunPausedEvent):
            paused = event
        else:
            yield event
    if paused is not None:
        try:
            for callback in pause_callbacks:
                callback()
        except Exception as error:
            for callback in pause_failure_callbacks:
                callback(error)
            raise
        yield paused
