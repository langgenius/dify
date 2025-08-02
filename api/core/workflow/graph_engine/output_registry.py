"""
OutputRegistry - Thread-safe storage for node outputs (streams and scalars)

This component provides thread-safe storage and retrieval of node outputs,
supporting both scalar values and streaming chunks with proper state management.
"""

from collections.abc import Sequence
from threading import RLock
from typing import Any, Optional


class OutputRegistry:
    """
    Thread-safe registry for storing and retrieving node outputs.

    Supports both scalar values and streaming chunks with proper state management.
    All operations are thread-safe using internal locking.
    """

    def __init__(self) -> None:
        """Initialize empty registry with thread-safe storage."""
        self._lock = RLock()
        self._scalars: dict[str, Any] = {}
        self._streams: dict[str, list[str]] = {}
        self._stream_closed: dict[str, bool] = {}
        self._stream_read_position: dict[str, int] = {}

    def _selector_to_key(self, selector: Sequence[str]) -> str:
        """Convert selector list to string key for internal storage."""
        return ".".join(selector)

    def set_scalar(self, selector: Sequence[str], value: Any) -> None:
        """
        Set a scalar value for the given selector.

        Args:
            selector: List of strings identifying the output location
            value: The scalar value to store
        """
        key = self._selector_to_key(selector)
        with self._lock:
            self._scalars[key] = value

    def get_scalar(self, selector: Sequence[str]) -> Any:
        """
        Get a scalar value for the given selector.

        Args:
            selector: List of strings identifying the output location

        Returns:
            The stored scalar value, or None if not found
        """
        key = self._selector_to_key(selector)
        with self._lock:
            return self._scalars.get(key)

    def append_chunk(self, selector: Sequence[str], chunk: str) -> None:
        """
        Append a chunk to the stream for the given selector.

        Args:
            selector: List of strings identifying the stream location
            chunk: The chunk content to append

        Raises:
            ValueError: If the stream is already closed
        """
        key = self._selector_to_key(selector)
        with self._lock:
            # Check if stream is closed
            if self._stream_closed.get(key, False):
                raise ValueError(f"Stream {key} is already closed")

            # Initialize stream if not exists
            if key not in self._streams:
                self._streams[key] = []
                self._stream_read_position[key] = 0

            # Append chunk
            self._streams[key].append(chunk)

    def pop_chunk(self, selector: Sequence[str]) -> Optional[str]:
        """
        Pop the next unread chunk from the stream.

        Args:
            selector: List of strings identifying the stream location

        Returns:
            The next chunk, or None if no unread chunks available
        """
        key = self._selector_to_key(selector)
        with self._lock:
            if key not in self._streams:
                return None

            stream = self._streams[key]
            position = self._stream_read_position.get(key, 0)

            if position >= len(stream):
                return None

            chunk = stream[position]
            self._stream_read_position[key] = position + 1
            return chunk

    def has_unread(self, selector: Sequence[str]) -> bool:
        """
        Check if the stream has unread chunks.

        Args:
            selector: List of strings identifying the stream location

        Returns:
            True if there are unread chunks, False otherwise
        """
        key = self._selector_to_key(selector)
        with self._lock:
            if key not in self._streams:
                return False

            stream = self._streams[key]
            position = self._stream_read_position.get(key, 0)
            return position < len(stream)

    def close_stream(self, selector: Sequence[str]) -> None:
        """
        Mark a stream as closed (no more chunks can be appended).

        Args:
            selector: List of strings identifying the stream location
        """
        key = self._selector_to_key(selector)
        with self._lock:
            self._stream_closed[key] = True

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
            return self._stream_closed.get(key, False)

    def serialize(self) -> dict[str, Any]:
        """
        Serialize the registry state to a dictionary.

        Returns:
            Dictionary containing all registry data
        """
        with self._lock:
            return {
                "scalars": self._scalars.copy(),
                "streams": self._streams.copy(),
                "stream_closed": self._stream_closed.copy(),
                "stream_read_position": self._stream_read_position.copy(),
            }

    @classmethod
    def deserialize(cls, data: dict[str, Any]) -> "OutputRegistry":
        """
        Create an OutputRegistry instance from serialized data.

        Args:
            data: Dictionary containing serialized registry data

        Returns:
            New OutputRegistry instance with the deserialized data
        """
        registry = cls()
        registry._scalars = data.get("scalars", {})
        registry._streams = data.get("streams", {})
        registry._stream_closed = data.get("stream_closed", {})
        registry._stream_read_position = data.get("stream_read_position", {})
        return registry
