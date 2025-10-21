"""
In-memory implementation of the ReadyQueue protocol.

This implementation wraps Python's standard queue.Queue and adds
serialization capabilities for state storage.
"""

import queue
from typing import final

from .protocol import ReadyQueue, ReadyQueueState


@final
class InMemoryReadyQueue(ReadyQueue):
    """
    In-memory ready queue implementation with serialization support.

    This implementation uses Python's queue.Queue internally and provides
    methods to serialize and restore the queue state.
    """

    def __init__(self, maxsize: int = 0) -> None:
        """
        Initialize the in-memory ready queue.

        Args:
            maxsize: Maximum size of the queue (0 for unlimited)
        """
        self._queue: queue.Queue[str] = queue.Queue(maxsize=maxsize)

    def put(self, item: str) -> None:
        """
        Add a node ID to the ready queue.

        Args:
            item: The node ID to add to the queue
        """
        self._queue.put(item)

    def get(self, timeout: float | None = None) -> str:
        """
        Retrieve and remove a node ID from the queue.

        Args:
            timeout: Maximum time to wait for an item (None for blocking)

        Returns:
            The node ID retrieved from the queue

        Raises:
            queue.Empty: If timeout expires and no item is available
        """
        if timeout is None:
            return self._queue.get(block=True)
        return self._queue.get(timeout=timeout)

    def task_done(self) -> None:
        """
        Indicate that a previously retrieved task is complete.

        Used by worker threads to signal task completion for
        join() synchronization.
        """
        self._queue.task_done()

    def empty(self) -> bool:
        """
        Check if the queue is empty.

        Returns:
            True if the queue has no items, False otherwise
        """
        return self._queue.empty()

    def qsize(self) -> int:
        """
        Get the approximate size of the queue.

        Returns:
            The approximate number of items in the queue
        """
        return self._queue.qsize()

    def dumps(self) -> str:
        """
        Serialize the queue state to a JSON string for storage.

        Returns:
            A JSON string containing the serialized queue state
        """
        # Extract all items from the queue without removing them
        items: list[str] = []
        temp_items: list[str] = []

        # Drain the queue temporarily to get all items
        while not self._queue.empty():
            try:
                item = self._queue.get_nowait()
                temp_items.append(item)
                items.append(item)
            except queue.Empty:
                break

        # Put items back in the same order
        for item in temp_items:
            self._queue.put(item)

        state = ReadyQueueState(
            type="InMemoryReadyQueue",
            version="1.0",
            items=items,
        )
        return state.model_dump_json()

    def loads(self, data: str) -> None:
        """
        Restore the queue state from a JSON string.

        Args:
            data: The JSON string containing the serialized queue state to restore
        """
        state = ReadyQueueState.model_validate_json(data)

        if state.type != "InMemoryReadyQueue":
            raise ValueError(f"Invalid serialized data type: {state.type}")

        if state.version != "1.0":
            raise ValueError(f"Unsupported version: {state.version}")

        # Clear the current queue
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break

        # Restore items
        for item in state.items:
            self._queue.put(item)
