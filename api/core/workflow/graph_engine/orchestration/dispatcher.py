"""
Main dispatcher for processing events from workers.
"""

import logging
import queue
import threading
import time
from typing import TYPE_CHECKING, final

from core.workflow.graph_events import (
    GraphNodeEventBase,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunSucceededEvent,
)

from ..event_management import EventManager
from .execution_coordinator import ExecutionCoordinator

if TYPE_CHECKING:
    from ..event_management import EventHandler

logger = logging.getLogger(__name__)


@final
class Dispatcher:
    """
    Main dispatcher that processes events from the event queue.

    This runs in a separate thread and coordinates event processing
    with timeout and completion detection.
    """

    _COMMAND_TRIGGER_EVENTS = (
        NodeRunSucceededEvent,
        NodeRunFailedEvent,
        NodeRunExceptionEvent,
    )

    def __init__(
        self,
        event_queue: queue.Queue[GraphNodeEventBase],
        event_handler: "EventHandler",
        execution_coordinator: ExecutionCoordinator,
        stop_event: threading.Event,
        event_emitter: EventManager | None = None,
    ) -> None:
        """
        Initialize the dispatcher.

        Args:
            event_queue: Queue of events from workers
            event_handler: Event handler registry for processing events
            execution_coordinator: Coordinator for execution flow
            event_emitter: Optional event manager to signal completion
        """
        self._event_queue = event_queue
        self._event_handler = event_handler
        self._execution_coordinator = execution_coordinator
        self._event_emitter = event_emitter

        self._thread: threading.Thread | None = None
        self._stop_event = stop_event
        self._start_time: float | None = None

    def start(self) -> None:
        """Start the dispatcher thread."""
        if self._thread and self._thread.is_alive():
            return

        self._start_time = time.time()
        self._thread = threading.Thread(target=self._dispatcher_loop, name="GraphDispatcher", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop the dispatcher thread."""
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)

    def _dispatcher_loop(self) -> None:
        """Main dispatcher loop."""
        try:
            self._process_commands()
            while not self._stop_event.is_set():
                if (
                    self._execution_coordinator.aborted
                    or self._execution_coordinator.paused
                    or self._execution_coordinator.execution_complete
                ):
                    break

                self._execution_coordinator.check_scaling()
                try:
                    event = self._event_queue.get(timeout=0.1)
                    self._event_handler.dispatch(event)
                    self._event_queue.task_done()
                    self._process_commands(event)
                except queue.Empty:
                    time.sleep(0.1)

            self._process_commands()
            while True:
                try:
                    event = self._event_queue.get(block=False)
                    self._event_handler.dispatch(event)
                    self._event_queue.task_done()
                except queue.Empty:
                    break

        except Exception as e:
            logger.exception("Dispatcher error")
            self._execution_coordinator.mark_failed(e)

        finally:
            self._execution_coordinator.mark_complete()
            # Signal the event emitter that execution is complete
            if self._event_emitter:
                self._event_emitter.mark_complete()

    def _process_commands(self, event: GraphNodeEventBase | None = None):
        if event is None or isinstance(event, self._COMMAND_TRIGGER_EVENTS):
            self._execution_coordinator.process_commands()
