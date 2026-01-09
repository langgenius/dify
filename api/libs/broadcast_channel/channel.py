"""
Broadcast channel for Pub/Sub messaging.
"""

from __future__ import annotations

import types
from abc import abstractmethod
from collections.abc import Iterator
from contextlib import AbstractContextManager
from typing import Protocol, Self


class Subscription(AbstractContextManager["Subscription"], Protocol):
    """A subscription to a topic that provides an iterator over received messages.
    The subscription can be used as a context manager and will automatically
    close when exiting the context.

    Note: `Subscription` instances are not thread-safe. Each thread should create its own
    subscription.
    """

    @abstractmethod
    def __iter__(self) -> Iterator[bytes]:
        """`__iter__` returns an iterator used to consume the message from this subscription.

        If the caller did not enter the context, `__iter__` may lazily perform the setup before
        yielding messages; otherwise `__enter__` handles it.”

        If the subscription is closed, then the returned  iterator exits without
        raising any error.
        """
        ...

    @abstractmethod
    def close(self) -> None:
        """close closes the subscription, releases any resources associated with it."""
        ...

    def __enter__(self) -> Self:
        """`__enter__` does the setup logic of the subscription (if any), and return itself."""
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: types.TracebackType | None,
    ) -> bool | None:
        self.close()
        return None

    @abstractmethod
    def receive(self, timeout: float | None = 0.1) -> bytes | None:
        """Receive the next message from the broadcast channel.

        If `timeout` is specified, this method returns `None` if no message is
        received within the given period. If `timeout` is `None`, the call blocks
        until a message is received.

        Calling receive with `timeout=None` is highly discouraged, as it is impossible to
        cancel a blocking subscription.

        :param timeout: timeout for receive message, in seconds.

        Returns:
            bytes: The received message as a byte string, or
            None: If the timeout expires before a message is received.

        Raises:
            SubscriptionClosed: If the subscription has already been closed.
        """
        ...


class Producer(Protocol):
    """Producer is an interface for message publishing. It is already bound to a specific topic.

    `Producer` implementations must be thread-safe and support concurrent use by multiple threads.
    """

    @abstractmethod
    def publish(self, payload: bytes) -> None:
        """Publish a message to the bounded topic."""
        ...


class Subscriber(Protocol):
    """Subscriber is an interface for subscription creation. It is already bound to a specific topic.

    `Subscriber` implementations must be thread-safe and support concurrent use by multiple threads.
    """

    @abstractmethod
    def subscribe(self) -> Subscription:
        pass


class Topic(Producer, Subscriber, Protocol):
    """A named channel for publishing and subscribing to messages.

    Topics provide both read and write access. For restricted access,
    use as_producer() for write-only view or as_subscriber() for read-only view.

    `Topic` implementations must be thread-safe and support concurrent use by multiple threads.
    """

    @abstractmethod
    def as_producer(self) -> Producer:
        """as_producer creates a write-only view for this topic."""
        ...

    @abstractmethod
    def as_subscriber(self) -> Subscriber:
        """as_subscriber create a read-only view for this topic."""
        ...


class BroadcastChannel(Protocol):
    """A broadcasting channel is a channel supporting broadcasting semantics.

    Each channel is identified by a topic, different topics are isolated and do not affect each other.

    There can be multiple subscriptions to a specific topic. When a publisher publishes a message to
    a specific topic, all subscription should receive the published message.

    There are no restriction for the persistence of messages. Once a subscription is created, it
    should receive all subsequent messages published.

    `BroadcastChannel` implementations must be thread-safe and support concurrent use by multiple threads.
    """

    @abstractmethod
    def topic(self, topic: str) -> Topic:
        """topic returns a `Topic` instance for the given topic name."""
        ...
