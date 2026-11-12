"""Runtime ready queue protocol."""

from __future__ import annotations

from abc import abstractmethod
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from .tasks import ReadyTask


class ReadyQueue(Protocol):
    """Structural interface required from ready queue implementations.

    Implementations may be in-memory or persistence-backed, but they must
    provide the same queue semantics and serialization surface.
    """

    @abstractmethod
    def put(self, item: ReadyTask) -> None:
        """Add a ready item to the ready queue.

        Args:
            item: The implementation-defined item to add to the queue.
        """
        ...

    @abstractmethod
    def get(self, timeout: float | None = None) -> ReadyTask:
        """Retrieve and remove the next ready item from the queue.

        Args:
            timeout: Maximum time to wait for an item. ``None`` blocks until an
                item becomes available.

        Returns:
            The implementation-defined item retrieved from the queue.
        """
        ...

    @abstractmethod
    def task_done(self) -> None:
        """Indicate that a previously retrieved task is complete.

        Used by worker threads to signal task completion for join-style
        synchronization.
        """
        ...

    @abstractmethod
    def qsize(self) -> int:
        """Return the approximate number of pending items awaiting execution.

        This method must be safe to call concurrently with other queue operations,
        including put and get.

        NOTE: Because the queue can be modified by other threads between the check
        and the subsequent use, this method is prone to TOCTOU errors.

        Returns:
            The approximate number of items currently in the queue.
        """
        ...

    @abstractmethod
    def take_all(self) -> list[ReadyTask]:
        """Remove and return every pending task in FIFO order.

        Returns:
            All tasks that were available when the operation began.

        """
        ...

    @abstractmethod
    def dumps(self) -> str:
        """Serialize the queue contents for persistence.

        Returns:
            A serialized representation of the queue state that can be stored
            and later restored.
        """
        ...

    @abstractmethod
    def loads(self, data: str) -> None:
        """Restore the queue contents from a serialized payload.

        Args:
            data: The serialized queue state to restore.
        """
        ...
