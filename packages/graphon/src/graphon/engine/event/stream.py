"""Thread-safe collection and delivery of engine events."""

import logging
import queue
from collections.abc import Generator
from typing import cast, final

from graphon.engine_events.base import EngineEvent

from ..layer import Layer

_logger = logging.getLogger(__name__)
_COMPLETE = object()


@final
class EventStream:
    """Collect, buffer, and stream engine events.

    The stream is the single event boundary between the engine and external
    consumers. It also notifies the engine's layers as events arrive.
    """

    def __init__(self, layers: list[Layer]) -> None:
        """Initialize an event stream bound to the engine's live layer list.

        The list is retained by reference so layers registered after engine
        construction are visible to the stream without a second configuration
        phase. Collected events are buffered until :meth:`emit_events` yields
        them, while lifecycle events can notify the same layers without being
        added to that buffer.

        Args:
            layers: Mutable list of layers owned by the engine.

        """
        self._events: queue.SimpleQueue[object] = queue.SimpleQueue()
        self._layers = layers

    def notify_layers(self, event: EngineEvent) -> None:
        """Notify all layers about an event without buffering it.

        Layer exceptions are caught and logged so one extension cannot disrupt
        event delivery to the remaining layers or the engine itself.

        Args:
            event: Event to send to every registered layer.

        """
        for layer in self._layers:
            try:
                layer.on_event(event)
            except Exception:
                _logger.exception("Error in layer on_event, layer_type=%s", type(layer))

    def collect(self, event: EngineEvent) -> None:
        """Thread-safe method to collect an event.

        Args:
            event: The event to collect

        """
        self._events.put(event)
        self.notify_layers(event)

    def mark_complete(self) -> None:
        """Mark execution as complete to stop the event emission generator."""
        self._events.put(_COMPLETE)

    def reset(self) -> None:
        """Discard events and completion state from the previous engine run."""
        self._events = queue.SimpleQueue()

    def emit_events(self) -> Generator[EngineEvent, None, None]:
        """Generator that yields events as they're collected.

        Yields:
            EngineEvent instances as they're processed

        """
        events = self._events
        while (event := events.get()) is not _COMPLETE:
            yield cast(EngineEvent, event)
