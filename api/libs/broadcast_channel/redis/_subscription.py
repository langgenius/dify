import logging
import queue
import threading
import types
from collections.abc import Generator, Iterator
from typing import Self

from libs.broadcast_channel.channel import Subscription
from libs.broadcast_channel.exc import SubscriptionClosedError
from redis.client import PubSub

_logger = logging.getLogger(__name__)


class RedisSubscriptionBase(Subscription):
    """Base class for Redis pub/sub subscriptions with common functionality.

    This class provides shared functionality for both regular and sharded
    Redis pub/sub subscriptions, reducing code duplication and improving
    maintainability.
    """

    def __init__(
        self,
        pubsub: PubSub,
        topic: str,
    ):
        # The _pubsub is None only if the subscription is closed.
        self._pubsub: PubSub | None = pubsub
        self._topic = topic
        self._closed = threading.Event()
        self._queue: queue.Queue[bytes] = queue.Queue(maxsize=1024)
        self._dropped_count = 0
        self._listener_thread: threading.Thread | None = None
        self._start_lock = threading.Lock()
        self._started = False

    def _start_if_needed(self) -> None:
        """Start the subscription if not already started."""
        with self._start_lock:
            if self._started:
                return
            if self._closed.is_set():
                raise SubscriptionClosedError(f"The Redis {self._get_subscription_type()} subscription is closed")
            if self._pubsub is None:
                raise SubscriptionClosedError(
                    f"The Redis {self._get_subscription_type()} subscription has been cleaned up"
                )

            self._subscribe()
            _logger.debug("Subscribed to %s channel %s", self._get_subscription_type(), self._topic)

            self._listener_thread = threading.Thread(
                target=self._listen,
                name=f"redis-{self._get_subscription_type().replace(' ', '-')}-broadcast-{self._topic}",
                daemon=True,
            )
            self._listener_thread.start()
            self._started = True

    def _listen(self) -> None:
        """Main listener loop for processing messages."""
        pubsub = self._pubsub
        assert pubsub is not None, "PubSub should not be None while starting listening."
        while not self._closed.is_set():
            try:
                raw_message = self._get_message()
            except Exception as e:
                # Log the exception and exit the listener thread gracefully
                # This handles Redis connection errors and other exceptions
                _logger.error(
                    "Error getting message from Redis %s subscription, topic=%s: %s",
                    self._get_subscription_type(),
                    self._topic,
                    e,
                    exc_info=True,
                )
                break

            if raw_message is None:
                continue

            if raw_message.get("type") != self._get_message_type():
                continue

            channel_field = raw_message.get("channel")
            if isinstance(channel_field, bytes):
                channel_name = channel_field.decode("utf-8")
            elif isinstance(channel_field, str):
                channel_name = channel_field
            else:
                channel_name = str(channel_field)

            if channel_name != self._topic:
                _logger.warning(
                    "Ignoring %s message from unexpected channel %s", self._get_subscription_type(), channel_name
                )
                continue

            payload_bytes: bytes | None = raw_message.get("data")
            if not isinstance(payload_bytes, bytes):
                _logger.error(
                    "Received invalid data from %s channel %s, type=%s",
                    self._get_subscription_type(),
                    self._topic,
                    type(payload_bytes),
                )
                continue

            self._enqueue_message(payload_bytes)

        _logger.debug("%s listener thread stopped for channel %s", self._get_subscription_type().title(), self._topic)
        try:
            self._unsubscribe()
            pubsub.close()
            _logger.debug("%s PubSub closed for topic %s", self._get_subscription_type().title(), self._topic)
        except Exception as e:
            _logger.error(
                "Error during cleanup of Redis %s subscription, topic=%s: %s",
                self._get_subscription_type(),
                self._topic,
                e,
                exc_info=True,
            )
        finally:
            self._pubsub = None

    def _enqueue_message(self, payload: bytes) -> None:
        """Enqueue a message to the internal queue with dropping behavior."""
        while not self._closed.is_set():
            try:
                self._queue.put_nowait(payload)
                return
            except queue.Full:
                try:
                    self._queue.get_nowait()
                    self._dropped_count += 1
                    _logger.debug(
                        "Dropped message from Redis %s subscription, topic=%s, total_dropped=%d",
                        self._get_subscription_type(),
                        self._topic,
                        self._dropped_count,
                    )
                except queue.Empty:
                    continue
        return

    def _message_iterator(self) -> Generator[bytes, None, None]:
        """Iterator for consuming messages from the subscription."""
        while not self._closed.is_set():
            try:
                item = self._queue.get(timeout=0.1)
            except queue.Empty:
                continue

            yield item

    def __iter__(self) -> Iterator[bytes]:
        """Return an iterator over messages from the subscription."""
        if self._closed.is_set():
            raise SubscriptionClosedError(f"The Redis {self._get_subscription_type()} subscription is closed")
        self._start_if_needed()
        return iter(self._message_iterator())

    def receive(self, timeout: float | None = None) -> bytes | None:
        """Receive the next message from the subscription."""
        if self._closed.is_set():
            raise SubscriptionClosedError(f"The Redis {self._get_subscription_type()} subscription is closed")
        self._start_if_needed()

        try:
            item = self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

        return item

    def __enter__(self) -> Self:
        """Context manager entry point."""
        self._start_if_needed()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: types.TracebackType | None,
    ) -> bool | None:
        """Context manager exit point."""
        self.close()
        return None

    def close(self) -> None:
        """Close the subscription and clean up resources."""
        if self._closed.is_set():
            return

        self._closed.set()
        # NOTE: PubSub is not thread-safe. More specifically, the `PubSub.close` method and the
        # message retrieval method should NOT be called concurrently.
        #
        # Due to the restriction above, the PubSub cleanup logic happens inside the consumer thread.
        listener = self._listener_thread
        if listener is not None:
            listener.join(timeout=1.0)
            self._listener_thread = None

    # Abstract methods to be implemented by subclasses
    def _get_subscription_type(self) -> str:
        """Return the subscription type (e.g., 'regular' or 'sharded')."""
        raise NotImplementedError

    def _subscribe(self) -> None:
        """Subscribe to the Redis topic using the appropriate command."""
        raise NotImplementedError

    def _unsubscribe(self) -> None:
        """Unsubscribe from the Redis topic using the appropriate command."""
        raise NotImplementedError

    def _get_message(self) -> dict | None:
        """Get a message from Redis using the appropriate method."""
        raise NotImplementedError

    def _get_message_type(self) -> str:
        """Return the expected message type (e.g., 'message' or 'smessage')."""
        raise NotImplementedError
