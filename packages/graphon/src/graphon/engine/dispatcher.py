"""Dispatch worker results onto the engine's state-transition thread."""

import logging
import queue
import threading
from typing import final

from graphon.engine_events.base import NodeEvent
from graphon.engine_events.node import (
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunModelPollingProgressEvent,
    NodeRunSucceededEvent,
)
from graphon.file.protocols import WorkflowFileRuntimeProtocol
from graphon.file.runtime import use_workflow_file_runtime
from graphon.runtime.execution import GraphExecution

from .command.processor import CommandProcessor
from .event.processor import NodeEventProcessor
from .event.stream import EventStream
from .scheduler import Scheduler
from .worker import ContainerAwaitTask, DispatchTask, WorkerPool

logger = logging.getLogger(__name__)


@final
class Dispatcher:
    """Process worker dispatch tasks on one state-transition thread.

    Workers only execute nodes and enqueue results. The dispatcher serializes
    those results, command processing, and execution completion detection.
    """

    _COMMAND_TRIGGER_EVENTS = (
        NodeRunSucceededEvent,
        NodeRunFailedEvent,
        NodeRunExceptionEvent,
        NodeRunModelPollingProgressEvent,
    )

    def __init__(
        self,
        dispatch_queue: queue.Queue[DispatchTask],
        event_processor: NodeEventProcessor,
        graph_execution: GraphExecution,
        scheduler: Scheduler,
        command_processor: CommandProcessor,
        worker_pool: WorkerPool,
        event_stream: EventStream,
        file_runtime: WorkflowFileRuntimeProtocol | None = None,
    ) -> None:
        """Initialize the dispatcher.

        Args:
            dispatch_queue: Queue of tasks produced by workers.
            event_processor: Processor that applies node events to frame state.
            graph_execution: Aggregate tracking graph execution state
            scheduler: Root frame scheduler and completion tracker.
            command_processor: Processor for external engine commands
            worker_pool: Pool executing ready node tasks
            event_stream: Stream to mark complete when dispatch ends.
            file_runtime: File adapter supplied by the engine.

        """
        self._dispatch_queue = dispatch_queue
        self._event_processor = event_processor
        self._graph_execution = graph_execution
        self._scheduler = scheduler
        self._command_processor = command_processor
        self._worker_pool = worker_pool
        self._event_stream = event_stream
        self._file_runtime = file_runtime

        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        """Start the dispatcher thread."""
        if self._thread and self._thread.is_alive():
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._dispatcher_loop,
            name="EngineDispatcher",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        """Stop the dispatcher thread."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)

    def _dispatcher_loop(self) -> None:
        """Main dispatcher loop."""
        with (
            use_workflow_file_runtime(self._file_runtime),
            self._graph_execution.track_execution(),
        ):
            self._dispatch_until_complete()

    def _dispatch_until_complete(self) -> None:
        """Process results and publish completion before releasing activity."""
        try:
            paused = self._run_until_exit()
            self._finish_dispatching(paused)
        except Exception as error:
            logger.exception("Dispatcher error")
            self._graph_execution.fail(error)
        finally:
            if not self._graph_execution.paused and not self._graph_execution.completed:
                self._graph_execution.complete()
            self._event_stream.mark_complete()

    def _run_until_exit(self) -> bool:
        self._process_commands()
        while not self._stop_event.is_set():
            if (
                self._graph_execution.aborted
                or self._graph_execution.error is not None
                or self._scheduler.is_execution_complete()
            ):
                return False
            if self._graph_execution.paused:
                pending_tasks = self._worker_pool.pause()
                self._scheduler.defer_ready_tasks(pending_tasks)
                return True
            self._dispatch_next_event()
        return False

    def _dispatch_next_event(self) -> None:
        try:
            task = self._dispatch_queue.get(timeout=0.1)
        except queue.Empty:
            self._process_commands()
            return
        event = self._dispatch_task(task)
        self._dispatch_queue.task_done()
        self._process_commands(event)

    def _finish_dispatching(self, paused: bool) -> None:
        """Process remaining dispatch work after the main loop exits.

        A cooperative pause waits for active workers while continuing to process
        their dispatch tasks, then snapshots frames if no abort or failure
        superseded the pause. Other terminal states process only tasks already in
        the queue.

        Args:
            paused: Whether the main loop exited because execution was paused.

        """
        self._process_commands()
        if paused:
            self._process_tasks_until_workers_idle()
            if (
                not self._graph_execution.aborted
                and self._graph_execution.error is None
            ):
                self._event_processor.snapshot_frames()
        else:
            self._process_pending_tasks()

    def _process_commands(self, event: NodeEvent | None = None) -> None:
        if event is None or isinstance(event, self._COMMAND_TRIGGER_EVENTS):
            self._command_processor.process_commands()

    def _process_pending_tasks(self) -> None:
        """Process every dispatch task currently available without waiting.

        The method handles both node events and container-await tasks through
        the normal dispatch path and marks each queue item complete. It returns
        as soon as the queue is empty.

        """
        while True:
            try:
                task = self._dispatch_queue.get(block=False)
            except queue.Empty:
                return
            self._dispatch_task(task)
            self._dispatch_queue.task_done()

    def _process_tasks_until_workers_idle(self) -> None:
        """Process dispatch tasks and commands until active workers become idle.

        This is the completion phase of a cooperative pause. Empty queue polls
        continue processing commands so an abort can supersede the pause while
        an active worker is still finishing its current task.

        """
        while (
            not self._stop_event.is_set()
            and not self._graph_execution.aborted
            and self._graph_execution.error is None
        ):
            try:
                task = self._dispatch_queue.get(timeout=0.1)
            except queue.Empty:
                self._process_commands()
                if not self._worker_pool.has_current_tasks():
                    break
                continue
            event = self._dispatch_task(task)
            self._dispatch_queue.task_done()
            self._process_commands(event)
        self._process_pending_tasks()

    def _dispatch_task(self, task: DispatchTask) -> NodeEvent | None:
        if isinstance(task, ContainerAwaitTask):
            self._event_processor.start_container(task)
            return None
        self._event_processor.dispatch(task)
        return task.event
