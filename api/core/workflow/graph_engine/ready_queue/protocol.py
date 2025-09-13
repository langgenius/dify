"""
ReadyQueue protocol for GraphEngine node execution queue.

This protocol defines the interface for managing the queue of nodes ready
for execution, supporting both in-memory and persistent storage scenarios.
"""

from typing import Protocol


class ReadyQueue(Protocol):
    """
    Protocol for managing nodes ready for execution in GraphEngine.

    This protocol defines the interface that any ready queue implementation
    must provide, enabling both in-memory queues and persistent queues
    that can be serialized for state storage.
    """

    def put(self, item: str) -> None:
        """
        Add a node ID to the ready queue.

        Args:
            item: The node ID to add to the queue
        """
        ...

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
        ...

    def task_done(self) -> None:
        """
        Indicate that a previously retrieved task is complete.

        Used by worker threads to signal task completion for
        join() synchronization.
        """
        ...

    def empty(self) -> bool:
        """
        Check if the queue is empty.

        Returns:
            True if the queue has no items, False otherwise
        """
        ...

    def qsize(self) -> int:
        """
        Get the approximate size of the queue.

        Returns:
            The approximate number of items in the queue
        """
        ...

    def dumps(self) -> dict[str, object]:
        """
        Serialize the queue state for storage.

        Returns:
            A dictionary containing the serialized queue state
            that can be persisted and later restored
        """
        ...

    def loads(self, data: dict[str, object]) -> None:
        """
        Restore the queue state from serialized data.

        Args:
            data: The serialized queue state to restore
        """
        ...
