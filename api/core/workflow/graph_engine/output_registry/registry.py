"""
Main OutputRegistry implementation.

This module contains the public OutputRegistry class that provides
thread-safe storage for node outputs.
"""

from collections.abc import Sequence
from threading import RLock
from typing import TYPE_CHECKING, Any, Union, final

from core.variables import Segment
from core.workflow.entities.variable_pool import VariablePool

from .stream import Stream

if TYPE_CHECKING:
    from core.workflow.graph_events import NodeRunStreamChunkEvent


@final
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
        self._streams: dict[tuple[str, ...], Stream] = {}

    def _selector_to_key(self, selector: Sequence[str]) -> tuple[str, ...]:
        """Convert selector list to tuple key for internal storage."""
        return tuple(selector)

    def set_scalar(
        self, selector: Sequence[str], value: Union[str, int, float, bool, dict[str, Any], list[Any]]
    ) -> None:
        """
        Set a scalar value for the given selector.

        Args:
            selector: List of strings identifying the output location
            value: The scalar value to store
        """
        with self._lock:
            self._scalars.add(selector, value)

    def get_scalar(self, selector: Sequence[str]) -> "Segment | None":
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

    def pop_chunk(self, selector: Sequence[str]) -> "NodeRunStreamChunkEvent | None":
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
