"""
ReadyQueue protocol for GraphEngine node execution queue.

This protocol defines the interface for managing the queue of nodes ready
for execution, supporting both in-memory and persistent storage scenarios.
"""

from collections.abc import Sequence
from typing import Protocol

from pydantic import BaseModel, Field


class ReadyQueueState(BaseModel):
    """
    Pydantic model for serialized ready queue state.

    This defines the structure of the data returned by dumps()
    and expected by loads() for ready queue serialization.
    """

    type: str = Field(description="Queue implementation type (e.g., 'InMemoryReadyQueue')")
    version: str = Field(description="Serialization format version")
    items: Sequence[str] = Field(default_factory=list, description="List of node IDs in the queue")


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

    def dumps(self) -> str:
        """
        Serialize the queue state to a JSON string for storage.

        Returns:
            A JSON string containing the serialized queue state
            that can be persisted and later restored
        """
        ...

    def loads(self, data: str) -> None:
        """
        Restore the queue state from a JSON string.

        Args:
            data: The JSON string containing the serialized queue state to restore
        """
        ...
