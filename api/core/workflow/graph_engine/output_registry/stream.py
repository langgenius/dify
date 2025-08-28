"""
Internal stream implementation for OutputRegistry.

This module contains the private Stream class used internally by OutputRegistry
to manage streaming data chunks.
"""

from typing import TYPE_CHECKING, final

if TYPE_CHECKING:
    from core.workflow.graph_events import NodeRunStreamChunkEvent


@final
class Stream:
    """
    A stream that holds NodeRunStreamChunkEvent objects and tracks read position.

    This class encapsulates stream-specific data and operations,
    including event storage, read position tracking, and closed state.

    Note: This is an internal class not exposed in the public API.
    """

    def __init__(self) -> None:
        """Initialize an empty stream."""
        self.events: list[NodeRunStreamChunkEvent] = []
        self.read_position: int = 0
        self.is_closed: bool = False

    def append(self, event: "NodeRunStreamChunkEvent") -> None:
        """
        Append a NodeRunStreamChunkEvent to the stream.

        Args:
            event: The NodeRunStreamChunkEvent to append

        Raises:
            ValueError: If the stream is already closed
        """
        if self.is_closed:
            raise ValueError("Cannot append to a closed stream")
        self.events.append(event)

    def pop_next(self) -> "NodeRunStreamChunkEvent | None":
        """
        Pop the next unread NodeRunStreamChunkEvent from the stream.

        Returns:
            The next event, or None if no unread events available
        """
        if self.read_position >= len(self.events):
            return None

        event = self.events[self.read_position]
        self.read_position += 1
        return event

    def has_unread(self) -> bool:
        """
        Check if the stream has unread events.

        Returns:
            True if there are unread events, False otherwise
        """
        return self.read_position < len(self.events)

    def close(self) -> None:
        """Mark the stream as closed (no more chunks can be appended)."""
        self.is_closed = True
