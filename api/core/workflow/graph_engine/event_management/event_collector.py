"""
Event collector for buffering and managing events.
"""

import threading

from core.workflow.graph_events import GraphEngineEvent

from ..layers.base import Layer


class EventCollector:
    """
    Collects and buffers events for later retrieval.

    This provides thread-safe event collection with support for
    notifying layers about events as they're collected.
    """

    def __init__(self) -> None:
        """Initialize the event collector."""
        self._events: list[GraphEngineEvent] = []
        self._lock = threading.Lock()
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
        with self._lock:
            self._events.append(event)
            self._notify_layers(event)

    def get_events(self) -> list[GraphEngineEvent]:
        """
        Get all collected events.

        Returns:
            List of collected events
        """
        with self._lock:
            return list(self._events)

    def get_new_events(self, start_index: int) -> list[GraphEngineEvent]:
        """
        Get new events starting from a specific index.

        Args:
            start_index: The index to start from

        Returns:
            List of new events
        """
        with self._lock:
            return list(self._events[start_index:])

    def event_count(self) -> int:
        """
        Get the current count of collected events.

        Returns:
            Number of collected events
        """
        with self._lock:
            return len(self._events)

    def clear(self) -> None:
        """Clear all collected events."""
        with self._lock:
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
