"""
Event router for dispatching events to appropriate handlers.
"""

import logging
from collections.abc import Callable
from typing import Optional

from core.workflow.graph_events import (
    GraphEngineEvent,
    GraphNodeEventBase,
    NodeRunIterationFailedEvent,
    NodeRunIterationNextEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
    NodeRunLoopFailedEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
)

from .event_collector import EventCollector

logger = logging.getLogger(__name__)


class EventRouter:
    """
    Routes events to appropriate handlers based on event type.

    This implements a simple event routing mechanism that maps event types
    to handler functions, with support for default handlers and error handling.
    """

    def __init__(self, event_collector: EventCollector) -> None:
        """
        Initialize the event router.

        Args:
            event_collector: Collector for buffering events
        """
        self.event_collector = event_collector
        # Using a more permissive type to allow specific event handlers
        self._handlers: dict[type[GraphEngineEvent], Callable] = {}
        self._setup_default_handlers()

    def _setup_default_handlers(self) -> None:
        """Set up the default event type to handler mapping."""
        # Iteration and loop events are collected directly
        iteration_loop_events = [
            NodeRunIterationStartedEvent,
            NodeRunIterationNextEvent,
            NodeRunIterationSucceededEvent,
            NodeRunIterationFailedEvent,
            NodeRunLoopStartedEvent,
            NodeRunLoopNextEvent,
            NodeRunLoopSucceededEvent,
            NodeRunLoopFailedEvent,
        ]

        for event_type in iteration_loop_events:
            self._handlers[event_type] = self.event_collector.collect  # type: ignore

    def register_handler(self, event_type: type[GraphEngineEvent], handler: Callable) -> None:
        """
        Register a handler for a specific event type.

        Args:
            event_type: The type of event to handle
            handler: The handler function to call
        """
        self._handlers[event_type] = handler

    def route_event(self, event: GraphNodeEventBase) -> None:
        """
        Route an event to its appropriate handler.

        Events in loops or iterations are collected directly.
        Other events are dispatched to their registered handlers.

        Args:
            event: The event to route
        """
        # Events in loops or iterations are always collected
        if event.in_loop_id or event.in_iteration_id:
            self.event_collector.collect(event)
            return

        # Find and execute the handler
        handler = self._get_handler(type(event))
        if handler:
            try:
                handler(event)
            except Exception as e:
                logger.error("Handler failed for event %s: %s", event.__class__.__name__, e, exc_info=True)
        else:
            # Collect unhandled events
            self.event_collector.collect(event)
            logger.warning("No handler registered for event: %r", event)

    def _get_handler(self, event_type: type[GraphEngineEvent]) -> Optional[Callable]:
        """
        Get the handler for an event type.

        Args:
            event_type: The type of event

        Returns:
            The handler function or None if not found
        """
        return self._handlers.get(event_type)
