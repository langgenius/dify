from __future__ import annotations

import dataclasses
import enum
import types
from abc import abstractmethod
from contextlib import AbstractContextManager
from typing import NewType, Protocol, Self, override

# A cursor is an opaque continuation token that may be persisted or transmitted
# and then returned unchanged to the topic that produced it. Callers must not
# parse, modify, order, synthesize, or rely on equality between cursors.
TopicCursor = NewType("TopicCursor", str)


class Closed(enum.Enum):
    """The terminal receive state for a closed subscription."""

    CLOSED = enum.auto()


CLOSED = Closed.CLOSED


@dataclasses.dataclass(slots=True, frozen=True)
class DurableStreamRecord:
    """One immutable record and the cursor that resumes strictly after it."""

    payload: bytes
    cursor: TopicCursor


class DurableStreamSubscription(
    AbstractContextManager["DurableStreamSubscription"],
    Protocol,
):
    """An independently positioned, one-shot subscription to one durable stream topic.

    The starting boundary is fixed when the topic creates the subscription.
    Entering the context acquires resources but must not recalculate that boundary.
    """

    @override
    @abstractmethod
    def __enter__(self) -> Self:
        """Establish delivery from the starting position fixed when the subscription was created."""
        ...

    @override
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: types.TracebackType | None,
    ) -> bool | None:
        self.close()
        return None

    @abstractmethod
    def close(self) -> None:
        """Close the subscription and release its resources.

        This method is idempotent and must not raise. It may be called from
        another thread and must unblock a receive call that is waiting for a
        record. The interrupted receive call returns CLOSED.
        """
        ...

    @abstractmethod
    def receive(self, timeout: float = 0.1) -> DurableStreamRecord | Closed | None:
        """Receive the next record.

        Return None when the timeout expires. Return CLOSED when the
        subscription is permanently closed.

        Raises:
            CursorUnavailableError: The backend reported that the current
                resume position is unavailable.
            DurableStreamUnavailableError: Delivery cannot continue without
                violating the stream contract.
        """
        ...


class DurableStreamProducer(Protocol):
    """A write-only interface already bound to one topic.

    Implementations must be thread-safe and support concurrent calls.
    """

    @abstractmethod
    def append(self, payload: bytes) -> None:
        """Append payload and return after the backend acknowledges the record.

        Raises:
            DurableStreamUnavailableError: The append failed or the topic is sealed.
        """
        ...


class DurableStreamTopic(DurableStreamProducer, Protocol):
    """A named, ordered durable stream with independent subscriptions.

    Implementations must be thread-safe and support concurrent calls.
    """

    @abstractmethod
    def as_producer(self) -> DurableStreamProducer:
        """Return a write-only view of this topic."""
        ...

    @abstractmethod
    def subscribe_from_beginning(self) -> DurableStreamSubscription:
        """Create a subscription starting at the earliest record retained at creation time."""
        ...

    @abstractmethod
    def subscribe_from_cursor(
        self,
        cursor: TopicCursor,
    ) -> DurableStreamSubscription:
        """Establish and return a subscription starting strictly after cursor.

        Raises:
            CursorUnavailableError: The cursor cannot be resolved by this topic.
            DurableStreamUnavailableError: The subscription cannot be established.
        """
        ...

    @abstractmethod
    def subscribe_from_tail(self) -> DurableStreamSubscription:
        """Create a subscription starting after the tail observed before this method returns."""
        ...

    @abstractmethod
    def seal(self) -> None:
        """Irreversibly prevent further appends to this topic.

        This operation is idempotent. Sealing finalizes the logical record
        sequence. Existing subscriptions may drain retained records and then
        receive CLOSED.
        """
        ...
