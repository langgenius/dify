"""
OutputRegistry - Thread-safe storage for node outputs (streams and scalars)

This component provides thread-safe storage and retrieval of node outputs,
supporting both scalar values and streaming chunks with proper state management.
"""

from collections.abc import Sequence
from threading import RLock
from typing import TYPE_CHECKING, Any, Optional

from core.workflow.entities.variable_pool import VariablePool

if TYPE_CHECKING:
    from core.workflow.graph_events.node import NodeRunStreamChunkEvent


class Stream:
    """
    A stream that holds NodeRunStreamChunkEvent objects and tracks read position.

    This class encapsulates stream-specific data and operations,
    including event storage, read position tracking, and closed state.
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

    def pop_next(self) -> Optional["NodeRunStreamChunkEvent"]:
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


class OutputRegistry:
    """
    Thread-safe registry for storing and retrieving node outputs.

    Supports both scalar values and streaming chunks with proper state management.
    All operations are thread-safe using internal locking.
    """

    def __init__(self, variable_pool: VariablePool) -> None:
        """Initialize empty registry with thread-safe storage."""
        self._lock = RLock()
        self._scalars = variable_pool
        self._streams: dict[tuple, Stream] = {}

    def _selector_to_key(self, selector: Sequence[str]):
        """Convert selector list to tuple key for internal storage."""
        return tuple(selector)

    def set_scalar(self, selector: Sequence[str], value: Any) -> None:
        """
        Set a scalar value for the given selector.

        Args:
            selector: List of strings identifying the output location
            value: The scalar value to store
        """
        with self._lock:
            self._scalars.add(selector, value)

    def get_scalar(self, selector: Sequence[str]):
        """
        Get a scalar value for the given selector.

        Args:
            selector: List of strings identifying the output location

        Returns:
            The stored Variable object, or None if not found
        """
        with self._lock:
            return self._scalars.get(selector)

    def append_chunk(self, selector: Sequence[str], event: "NodeRunStreamChunkEvent") -> None:
        """
        Append a NodeRunStreamChunkEvent to the stream for the given selector.

        Args:
            selector: List of strings identifying the stream location
            event: The NodeRunStreamChunkEvent to append

        Raises:
            ValueError: If the stream is already closed
        """
        key = self._selector_to_key(selector)
        with self._lock:
            if key not in self._streams:
                self._streams[key] = Stream()

            try:
                self._streams[key].append(event)
            except ValueError:
                raise ValueError(f"Stream {'.'.join(selector)} is already closed")

    def pop_chunk(self, selector: Sequence[str]) -> Optional["NodeRunStreamChunkEvent"]:
        """
        Pop the next unread NodeRunStreamChunkEvent from the stream.

        Args:
            selector: List of strings identifying the stream location

        Returns:
            The next event, or None if no unread events available
        """
        key = self._selector_to_key(selector)
        with self._lock:
            if key not in self._streams:
                return None

            return self._streams[key].pop_next()

    def has_unread(self, selector: Sequence[str]) -> bool:
        """
        Check if the stream has unread events.

        Args:
            selector: List of strings identifying the stream location

        Returns:
            True if there are unread events, False otherwise
        """
        key = self._selector_to_key(selector)
        with self._lock:
            if key not in self._streams:
                return False

            return self._streams[key].has_unread()

    def close_stream(self, selector: Sequence[str]) -> None:
        """
        Mark a stream as closed (no more chunks can be appended).

        Args:
            selector: List of strings identifying the stream location
        """
        key = self._selector_to_key(selector)
        with self._lock:
            if key not in self._streams:
                self._streams[key] = Stream()
            self._streams[key].close()

    def stream_closed(self, selector: Sequence[str]) -> bool:
        """
        Check if a stream is closed.

        Args:
            selector: List of strings identifying the stream location

        Returns:
            True if the stream is closed, False otherwise
        """
        key = self._selector_to_key(selector)
        with self._lock:
            if key not in self._streams:
                return False
            return self._streams[key].is_closed
