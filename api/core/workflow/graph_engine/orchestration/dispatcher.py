"""
Main dispatcher for processing events from workers.
"""

import logging
import queue
import threading
import time
from typing import TYPE_CHECKING, final

from core.workflow.graph_events.base import GraphNodeEventBase

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

    def __init__(
        self,
        event_queue: queue.Queue[GraphNodeEventBase],
        event_handler: "EventHandler",
        event_collector: EventManager,
        execution_coordinator: ExecutionCoordinator,
        event_emitter: EventManager | None = None,
    ) -> None:
        """
        Initialize the dispatcher.

        Args:
            event_queue: Queue of events from workers
            event_handler: Event handler registry for processing events
            event_collector: Event manager for collecting unhandled events
            execution_coordinator: Coordinator for execution flow
            event_emitter: Optional event manager to signal completion
        """
        self._event_queue = event_queue
        self._event_handler = event_handler
        self._event_collector = event_collector
        self._execution_coordinator = execution_coordinator
        self._event_emitter = event_emitter

        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._start_time: float | None = None

    def start(self) -> None:
        """Start the dispatcher thread."""
        if self._thread and self._thread.is_alive():
            return

        self._stop_event.clear()
        self._start_time = time.time()
        self._thread = threading.Thread(target=self._dispatcher_loop, name="GraphDispatcher", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop the dispatcher thread."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10.0)

    def _dispatcher_loop(self) -> None:
        """Main dispatcher loop."""
        try:
            while not self._stop_event.is_set():
                # Check for commands
                self._execution_coordinator.check_commands()

                # Check for scaling
                self._execution_coordinator.check_scaling()

                # Process events
                try:
                    event = self._event_queue.get(timeout=0.1)
                    # Route to the event handler
                    self._event_handler.dispatch(event)
                    self._event_queue.task_done()
                except queue.Empty:
                    # Check if execution is complete
                    if self._execution_coordinator.is_execution_complete():
                        break

        except Exception as e:
            logger.exception("Dispatcher error")
            self._execution_coordinator.mark_failed(e)

        finally:
            self._execution_coordinator.mark_complete()
            # Signal the event emitter that execution is complete
            if self._event_emitter:
                self._event_emitter.mark_complete()
