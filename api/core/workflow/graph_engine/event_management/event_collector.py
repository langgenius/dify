"""
Event collector for buffering and managing events.
"""

import threading
from typing import final

from core.workflow.graph_events import GraphEngineEvent

from ..layers.base import Layer


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
        self._read_ready.acquire()
        try:
            self._readers += 1
        finally:
            self._read_ready.release()

    def release_read(self) -> None:
        """Release a read lock."""
        self._read_ready.acquire()
        try:
            self._readers -= 1
            if self._readers == 0:
                self._read_ready.notify_all()
        finally:
            self._read_ready.release()

    def acquire_write(self) -> None:
        """Acquire a write lock."""
        self._read_ready.acquire()
        while self._readers > 0:
            self._read_ready.wait()

    def release_write(self) -> None:
        """Release a write lock."""
        self._read_ready.release()

    def read_lock(self) -> "ReadLockContext":
        """Return a context manager for read locking."""
        return ReadLockContext(self)

    def write_lock(self) -> "WriteLockContext":
        """Return a context manager for write locking."""
        return WriteLockContext(self)


@final
class ReadLockContext:
    """Context manager for read locks."""

    def __init__(self, lock: ReadWriteLock) -> None:
        self._lock = lock

    def __enter__(self) -> "ReadLockContext":
        self._lock.acquire_read()
        return self

    def __exit__(self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: object) -> None:
        self._lock.release_read()


@final
class WriteLockContext:
    """Context manager for write locks."""

    def __init__(self, lock: ReadWriteLock) -> None:
        self._lock = lock

    def __enter__(self) -> "WriteLockContext":
        self._lock.acquire_write()
        return self

    def __exit__(self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: object) -> None:
        self._lock.release_write()


@final
class EventCollector:
    """
    Collects and buffers events for later retrieval.

    This provides thread-safe event collection with support for
    notifying layers about events as they're collected.
    """

    def __init__(self) -> None:
        """Initialize the event collector."""
        self._events: list[GraphEngineEvent] = []
        self._lock = ReadWriteLock()
        self._layers: list[Layer] = []

    def set_layers(self, layers: list[Layer]) -> None:
        """
        Set the layers to notify on event collection.

        Args:
            layers: List of layers to notify
        """
        self._layers = layers

    def collect(self, event: GraphEngineEvent) -> None:
        """
        Thread-safe method to collect an event.

        Args:
            event: The event to collect
        """
        with self._lock.write_lock():
            self._events.append(event)
            self._notify_layers(event)

    def get_events(self) -> list[GraphEngineEvent]:
        """
        Get all collected events.

        Returns:
            List of collected events
        """
        with self._lock.read_lock():
            return list(self._events)

    def get_new_events(self, start_index: int) -> list[GraphEngineEvent]:
        """
        Get new events starting from a specific index.

        Args:
            start_index: The index to start from

        Returns:
            List of new events
        """
        with self._lock.read_lock():
            return list(self._events[start_index:])

    def event_count(self) -> int:
        """
        Get the current count of collected events.

        Returns:
            Number of collected events
        """
        with self._lock.read_lock():
            return len(self._events)

    def clear(self) -> None:
        """Clear all collected events."""
        with self._lock.write_lock():
            self._events.clear()

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
