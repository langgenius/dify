"""Worker thread for queue-based node execution.

Workers pull tasks from the ready queue, execute nodes, and push dispatch tasks
to the dispatch queue for the dispatcher to process.
"""

import logging
import queue
import sys
import threading
from collections.abc import Iterator, Sequence
from contextlib import ExitStack, contextmanager, nullcontext
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import final, override
from uuid import uuid4

from graphon.engine.frame import FrameRegistry
from graphon.engine.layer import Layer
from graphon.engine_events.base import NodeEvent
from graphon.engine_events.node import (
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    is_node_result_event,
)
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.file.protocols import WorkflowFileRuntimeProtocol
from graphon.file.runtime import use_workflow_file_runtime
from graphon.node_events.base import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.nodes.container_effects import (
    ContainerAwaitRequest,
)
from graphon.runtime.container_state import create_container_run_state
from graphon.runtime.execution import ROOT_FRAME_ID
from graphon.runtime.ready_queue import (
    ReadyQueue,
    ReadyTask,
    StartTask,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class NodeEventTask:
    frame_id: str
    event: NodeEvent


@dataclass(frozen=True, slots=True)
class ContainerAwaitTask:
    invocation_id: str
    request: ContainerAwaitRequest


type DispatchTask = NodeEventTask | ContainerAwaitTask


@final
class Worker(threading.Thread):
    """Worker thread that executes nodes from the ready queue.

    Workers continuously pull node IDs from the ready_queue, execute the
    corresponding nodes, and push the resulting tasks to the dispatch queue
    for the dispatcher to process.
    """

    def __init__(
        self,
        ready_queue: ReadyQueue,
        dispatch_queue: queue.Queue[DispatchTask],
        frame_registry: FrameRegistry,
        layers: Sequence[Layer],
        task_acquisition_lock: threading.Lock,
        task_acquisition_enabled: threading.Event,
        worker_id: int = 0,
        file_runtime: WorkflowFileRuntimeProtocol | None = None,
    ) -> None:
        """Initialize worker thread.

        Args:
            ready_queue: Ready queue containing node IDs ready for execution
            dispatch_queue: Queue for pushing task-scoped execution results.
            frame_registry: Registry containing frame-local graphs to execute
            layers: Engine layers for node execution hooks
            task_acquisition_lock: Shared lock that makes acquiring a ready task
                atomic with pausing the worker pool.
            task_acquisition_enabled: Shared flag indicating whether workers may
                acquire new ready tasks.
            worker_id: Unique identifier for this worker
            file_runtime: File adapter supplied by the engine.

        """
        super().__init__(name=f"EngineWorker-{worker_id}", daemon=True)
        self._ready_queue = ready_queue
        self._dispatch_queue = dispatch_queue
        self._frame_registry = frame_registry
        self._file_runtime = file_runtime
        self._stop_event = threading.Event()
        self._layers = layers
        self._task_acquisition_lock = task_acquisition_lock
        self._task_acquisition_enabled = task_acquisition_enabled
        self._current_node_started_at: datetime | None = None
        self._current_node: Node | None = None
        self._current_frame_id = ROOT_FRAME_ID
        self._has_current_task = threading.Event()

    def stop(self) -> None:
        """Signal the worker to stop processing."""
        self._stop_event.set()

    @property
    def has_current_task(self) -> bool:
        """Return True while the worker owns a queue task."""
        return self._has_current_task.is_set()

    @override
    def run(self) -> None:
        """Main worker loop.

        Continuously pulls node IDs from ready_queue, executes them,
        and pushes results to the dispatch queue until stopped.
        """
        frames = self._frame_registry.frames()
        with (
            use_workflow_file_runtime(self._file_runtime),
            frames[0].state.graph_execution.track_execution()
            if frames
            else nullcontext(),
        ):
            self._run_tasks()

    def _run_tasks(self) -> None:
        """Acquire and execute tasks until this worker is stopped."""
        while not self._stop_event.is_set():
            with self._task_acquisition_lock:
                if not self._task_acquisition_enabled.is_set():
                    return
                try:
                    task = self._ready_queue.get(timeout=0.01)
                except queue.Empty:
                    continue
                self._has_current_task.set()
            try:
                self._execute_task(task)
            except Exception as e:
                if self._current_node is None:
                    raise
                node = self._current_node
                logger.exception(
                    "Worker failed while executing node %s",
                    node.id,
                )
                self._dispatch_queue.put(
                    NodeEventTask(
                        frame_id=self._current_frame_id,
                        event=self._build_fallback_failure_event(
                            node,
                            e,
                            started_at=self._current_node_started_at,
                        ),
                    )
                )
            finally:
                self._ready_queue.task_done()
                self._current_node_started_at = None
                self._current_node = None
                self._current_frame_id = ROOT_FRAME_ID
                self._has_current_task.clear()

    def _execute_task(self, task: ReadyTask) -> None:
        if isinstance(task, StartTask):
            self._current_frame_id = task.frame_id
            node = self._frame_registry[task.frame_id].graph.nodes[task.node_id]
            self._current_node = node
            self._execute_node(frame_id=task.frame_id, node=node)
            return
        root_runtime_state = self._frame_registry[ROOT_FRAME_ID].state
        run_state = root_runtime_state.get_container_run(task.invocation_id)
        self._current_frame_id = run_state.frame_id
        node = self._frame_registry[run_state.frame_id].graph.nodes[run_state.node_id]
        self._bind_execution_id(frame_id=run_state.frame_id, node=node)
        self._current_node = node
        self._current_node_started_at = run_state.started_at
        try:
            suspended = self._run_node_events(
                invocation_id=run_state.invocation_id,
                node=node,
                node_events=node.resume_container(
                    result=task.result,
                    started_at=run_state.started_at,
                ),
            )
        except Exception:
            root_runtime_state.pop_container_run(run_state.invocation_id)
            raise
        if suspended:
            return
        root_runtime_state.pop_container_run(run_state.invocation_id)

    def _execute_node(self, *, frame_id: str, node: Node) -> None:
        """Execute a single node and handle its events.

        Args:
            node: The node instance to execute

        """
        self._bind_execution_id(frame_id=frame_id, node=node)

        self._run_node_events(
            invocation_id=None,
            node=node,
            node_events=node.run(),
        )

    def _bind_execution_id(self, *, frame_id: str, node: Node) -> None:
        frame = self._frame_registry[frame_id]
        node_execution = frame.state.graph_execution.get_or_create_node_execution(
            frame_id=frame_id,
            node_id=node.id,
        )
        node.bind_execution_id(node_execution.execution_id)

    def _run_node_events(
        self,
        *,
        invocation_id: str | None,
        node: Node,
        node_events: Iterator[NodeEvent | ContainerAwaitRequest],
    ) -> bool:
        error: Exception | None = None
        result_event: NodeEvent | None = None
        suspended = False
        with ExitStack() as contexts:
            if self._layers:
                parent_execution_id = self._parent_execution_id()
                for layer in self._layers:
                    contexts.enter_context(
                        self._node_run_context(layer, node, parent_execution_id),
                    )
            if invocation_id is None:
                self._invoke_node_run_start_hooks(node)
            try:
                result_event, suspended = self._consume_node_events(
                    invocation_id=invocation_id,
                    node=node,
                    node_events=node_events,
                )
            except Exception as exc:
                error = exc
                raise
            else:
                return suspended
            finally:
                if not suspended:
                    self._invoke_node_run_end_hooks(node, error, result_event)

    def _parent_execution_id(self) -> str | None:
        if self._current_frame_id == ROOT_FRAME_ID:
            return None
        root_state = self._frame_registry[ROOT_FRAME_ID].state
        frame_state = root_state.get_container_frame(self._current_frame_id)
        parent_run = root_state.get_container_run(frame_state.parent_invocation_id)
        parent_state = self._frame_registry[parent_run.frame_id].state
        return parent_state.graph_execution.get_or_create_node_execution(
            frame_id=parent_run.frame_id,
            node_id=parent_run.node_id,
        ).execution_id

    @contextmanager
    def _node_run_context(
        self,
        layer: Layer,
        node: Node,
        parent_execution_id: str | None,
    ) -> Iterator[None]:
        try:
            context = layer.node_run_context(
                node, parent_execution_id=parent_execution_id
            )
            # Isolate activation failures separately from errors raised by the node.
            context.__enter__()  # ruff: ignore[unnecessary-dunder-call]
        except Exception:
            logger.exception(
                "Layer %s failed entering node_run_context for node %s",
                type(layer).__name__,
                node.id,
            )
            yield
            return
        try:
            yield
        finally:
            try:
                context.__exit__(*sys.exc_info())
            except Exception:
                logger.exception(
                    "Layer %s failed exiting node_run_context for node %s",
                    type(layer).__name__,
                    node.id,
                )

    def _consume_node_events(
        self,
        *,
        invocation_id: str | None,
        node: Node,
        node_events: Iterator[NodeEvent | ContainerAwaitRequest],
    ) -> tuple[NodeEvent | None, bool]:
        result_event: NodeEvent | None = None
        for event in node_events:
            if isinstance(event, ContainerAwaitRequest):
                started_at = self._current_node_started_at
                if started_at is None:
                    msg = "container await request emitted before node start"
                    raise RuntimeError(msg)
                root_runtime_state = self._frame_registry[ROOT_FRAME_ID].state
                if invocation_id is None:
                    invocation_id = str(uuid4())
                    root_runtime_state.put_container_run(
                        create_container_run_state(
                            invocation_id=invocation_id,
                            frame_id=self._current_frame_id,
                            node_id=node.id,
                            started_at=started_at,
                            request=event,
                        )
                    )
                self._dispatch_queue.put(
                    ContainerAwaitTask(
                        invocation_id=invocation_id,
                        request=event,
                    )
                )
                return None, True
            if isinstance(event, NodeRunStartedEvent) and event.id == node.execution_id:
                self._current_node_started_at = event.start_at
            self._dispatch_queue.put(
                NodeEventTask(frame_id=self._current_frame_id, event=event)
            )
            if is_node_result_event(event):
                result_event = event
        return result_event, False

    def _invoke_node_run_start_hooks(self, node: Node) -> None:
        """Invoke on_node_run_start hooks for all layers."""
        for layer in self._layers:
            try:
                layer.on_node_run_start(node)
            except Exception:
                logger.exception(
                    "Layer %s failed in on_node_run_start for node %s",
                    type(layer).__name__,
                    node.id,
                )
                continue

    def _invoke_node_run_end_hooks(
        self,
        node: Node,
        error: Exception | None,
        result_event: NodeEvent | None = None,
    ) -> None:
        """Invoke on_node_run_end hooks for all layers."""
        for layer in self._layers:
            try:
                layer.on_node_run_end(node, error, result_event)
            except Exception:
                logger.exception(
                    "Layer %s failed in on_node_run_end for node %s",
                    type(layer).__name__,
                    node.id,
                )
                continue

    def _build_fallback_failure_event(
        self,
        node: Node,
        error: Exception,
        *,
        started_at: datetime | None = None,
    ) -> NodeRunFailedEvent:
        """Build a failure event when worker execution aborts before node output."""
        failure_time = datetime.now(UTC).replace(tzinfo=None)
        error_message = str(error)
        return NodeRunFailedEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type=node.node_type,
            error=error_message,
            start_at=started_at or failure_time,
            finished_at=failure_time,
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=error_message,
                error_type=type(error).__name__,
            ),
        )
