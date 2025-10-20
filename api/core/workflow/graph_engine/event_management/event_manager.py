"""
Unified event manager for collecting and emitting events.
"""

import threading
import time
from collections.abc import Generator
from contextlib import contextmanager
from typing import final

from core.workflow.graph_events import GraphEngineEvent

from ..layers.base import GraphEngineLayer


@final
class ReadWriteLock:
    """
    A read-write lock implementation that allows multiple concurrent readers
    but only one writer at a time.
    """

    def __init__(self) -> None:
        self._read_ready = threading.Condition(threading.RLock())
        self._readers = 0

    def acquire_read(self) -> None:
        """Acquire a read lock."""
        _ = self._read_ready.acquire()
        try:
            self._readers += 1
        finally:
            self._read_ready.release()

    def release_read(self) -> None:
        """Release a read lock."""
        _ = self._read_ready.acquire()
        try:
            self._readers -= 1
            if self._readers == 0:
                self._read_ready.notify_all()
        finally:
            self._read_ready.release()

    def acquire_write(self) -> None:
        """Acquire a write lock."""
        _ = self._read_ready.acquire()
        while self._readers > 0:
            _ = self._read_ready.wait()

    def release_write(self) -> None:
        """Release a write lock."""
        self._read_ready.release()

    @contextmanager
    def read_lock(self):
        """Return a context manager for read locking."""
        self.acquire_read()
        try:
            yield
        finally:
            self.release_read()

    @contextmanager
    def write_lock(self):
        """Return a context manager for write locking."""
        self.acquire_write()
        try:
            yield
        finally:
            self.release_write()


@final
class EventManager:
    """
    Unified event manager that collects, buffers, and emits events.

    This class combines event collection with event emission, providing
    thread-safe event management with support for notifying layers and
    streaming events to external consumers.
    """

    def __init__(self) -> None:
        """Initialize the event manager."""
        self._events: list[GraphEngineEvent] = []
        self._lock = ReadWriteLock()
        self._layers: list[GraphEngineLayer] = []
        self._execution_complete = threading.Event()

    def set_layers(self, layers: list[GraphEngineLayer]) -> None:
        """
        Set the layers to notify on event collection.

        Args:
            layers: List of layers to notify
        """
        self._layers = layers

    def notify_layers(self, event: GraphEngineEvent) -> None:
        """Notify registered layers about an event without buffering it."""
        self._notify_layers(event)

    def collect(self, event: GraphEngineEvent) -> None:
        """
        Thread-safe method to collect an event.

        Args:
            event: The event to collect
        """
        with self._lock.write_lock():
            self._events.append(event)
            self._notify_layers(event)

    def _get_new_events(self, start_index: int) -> list[GraphEngineEvent]:
        """
        Get new events starting from a specific index.

        Args:
            start_index: The index to start from

        Returns:
            List of new events
        """
        with self._lock.read_lock():
            return list(self._events[start_index:])

    def _event_count(self) -> int:
        """
        Get the current count of collected events.

        Returns:
            Number of collected events
        """
        with self._lock.read_lock():
            return len(self._events)

    def mark_complete(self) -> None:
        """Mark execution as complete to stop the event emission generator."""
        self._execution_complete.set()

    def emit_events(self) -> Generator[GraphEngineEvent, None, None]:
        """
        Generator that yields events as they're collected.

        Yields:
            GraphEngineEvent instances as they're processed
        """
        yielded_count = 0

        while not self._execution_complete.is_set() or yielded_count < self._event_count():
            # Get new events since last yield
            new_events = self._get_new_events(yielded_count)

            # Yield any new events
            for event in new_events:
                yield event
                yielded_count += 1

            # Small sleep to avoid busy waiting
            if not self._execution_complete.is_set() and not new_events:
                time.sleep(0.001)

    def _notify_layers(self, event: GraphEngineEvent) -> None:
        """
        Notify all layers of an event.

        Layer exceptions are caught and logged to prevent disrupting collection.

        Args:
            event: The event to send to layers
        """
        for layer in self._layers:
            try:
                layer.on_event(event)
            except Exception:
                # Silently ignore layer errors during collection
                pass
