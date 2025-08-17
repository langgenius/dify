"""
Main dispatcher for processing events from workers.
"""

import logging
import queue
import threading
import time
from typing import Optional

from ..event_management import EventEmitter, EventRouter
from .execution_coordinator import ExecutionCoordinator

logger = logging.getLogger(__name__)


class Dispatcher:
    """
    Main dispatcher that processes events from the event queue.

    This runs in a separate thread and coordinates event processing
    with timeout and completion detection.
    """

    def __init__(
        self,
        event_queue: queue.Queue,
        event_router: EventRouter,
        execution_coordinator: ExecutionCoordinator,
        max_execution_time: int,
        event_emitter: Optional[EventEmitter] = None,
    ) -> None:
        """
        Initialize the dispatcher.

        Args:
            event_queue: Queue of events from workers
            event_router: Router for dispatching events
            execution_coordinator: Coordinator for execution flow
            max_execution_time: Maximum execution time in seconds
            event_emitter: Optional event emitter to signal completion
        """
        self.event_queue = event_queue
        self.event_router = event_router
        self.execution_coordinator = execution_coordinator
        self.max_execution_time = max_execution_time
        self.event_emitter = event_emitter

        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._start_time: Optional[float] = None

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
                # Check timeout
                if self._check_timeout():
                    break

                # Check for commands
                self.execution_coordinator.check_commands()

                # Check for scaling
                self.execution_coordinator.check_scaling()

                # Process events
                try:
                    event = self.event_queue.get(timeout=0.1)
                    self.event_router.route_event(event)
                    self.event_queue.task_done()
                except queue.Empty:
                    # Check if execution is complete
                    if self.execution_coordinator.is_execution_complete():
                        break

        except Exception as e:
            logger.exception("Dispatcher error")
            self.execution_coordinator.mark_failed(e)

        finally:
            self.execution_coordinator.mark_complete()
            # Signal the event emitter that execution is complete
            if self.event_emitter:
                self.event_emitter.mark_complete()

    def _check_timeout(self) -> bool:
        """
        Check if execution has timed out.

        Returns:
            True if timed out
        """
        if self._start_time and time.time() - self._start_time > self.max_execution_time:
            raise TimeoutError(f"Execution exceeded maximum time of {self.max_execution_time} seconds")
        return False
