"""
Event emitter for yielding events to external consumers.
"""

import threading
import time
from collections.abc import Generator
from typing import final

from core.workflow.graph_events import GraphEngineEvent

from .event_collector import EventCollector


@final
class EventEmitter:
    """
    Emits collected events as a generator for external consumption.

    This provides a generator interface for yielding events as they're
    collected, with proper synchronization for multi-threaded access.
    """

    def __init__(self, event_collector: EventCollector) -> None:
        """
        Initialize the event emitter.

        Args:
            event_collector: The collector to emit events from
        """
        self.event_collector = event_collector
        self._execution_complete = threading.Event()

    def mark_complete(self) -> None:
        """Mark execution as complete to stop the generator."""
        self._execution_complete.set()

    def emit_events(self) -> Generator[GraphEngineEvent, None, None]:
        """
        Generator that yields events as they're collected.

        Yields:
            GraphEngineEvent instances as they're processed
        """
        yielded_count = 0

        while not self._execution_complete.is_set() or yielded_count < self.event_collector.event_count():
            # Get new events since last yield
            new_events = self.event_collector.get_new_events(yielded_count)

            # Yield any new events
            for event in new_events:
                yield event
                yielded_count += 1

            # Small sleep to avoid busy waiting
            if not self._execution_complete.is_set() and not new_events:
                time.sleep(0.001)
