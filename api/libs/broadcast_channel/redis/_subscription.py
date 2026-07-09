import logging
import queue
import threading
import types
from collections.abc import Generator, Iterator
from typing import Any, Self, override

from libs.broadcast_channel.channel import Subscription
from libs.broadcast_channel.exc import SubscriptionClosedError
from libs.broadcast_channel.signals import SIG_CLOSE
from redis import Redis, RedisCluster
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
        client: Redis | RedisCluster,
        pubsub: PubSub,
        topic: str,
    ):
        # The _pubsub is None only if the subscription is closed.
        self._client = client
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

            # If close() sent a control event to unblock us, exit immediately
            # without processing any message — the subscription is shutting down.
            if self._closed.is_set():
                break

            if raw_message.get("type") != self._get_message_type():
                continue

            channel_field = raw_message.get("channel")
            match channel_field:
                case bytes():
                    channel_name = channel_field.decode("utf-8")
                case str():
                    channel_name = channel_field
                case _:
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
            if payload_bytes == SIG_CLOSE:
                break

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
                item = self._queue.get(timeout=1)
            except queue.Empty:
                continue

            if self._closed.is_set():
                return

            yield item

    @override
    def __iter__(self) -> Iterator[bytes]:
        """Return an iterator over messages from the subscription."""
        if self._closed.is_set():
            return iter(())
        try:
            self._start_if_needed()
        except SubscriptionClosedError:
            return iter(())
        return iter(self._message_iterator())

    @override
    def receive(self, timeout: float | None = 0.1) -> bytes | None:
        """Receive the next message from the subscription."""
        if self._closed.is_set():
            raise SubscriptionClosedError(f"The Redis {self._get_subscription_type()} subscription is closed")
        self._start_if_needed()

        try:
            item = self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

        return item

    @override
    def __enter__(self) -> Self:
        """Context manager entry point."""
        self._start_if_needed()
        return self

    @override
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: types.TracebackType | None,
    ) -> bool | None:
        """Context manager exit point."""
        self.close()
        return None

    @override
    def close(self) -> None:
        """Close the subscription and clean up resources."""
        with self._start_lock:
            if self._closed.is_set():
                return

            self._closed.set()
            listener = self._listener_thread
            self._listener_thread = None
            started = self._started

        if started:
            self._unblock_message_iterator()

        # Send a control event on the same Redis channel to unblock the
        self._publish_close_event()

        # NOTE: PubSub is not thread-safe. More specifically, the `PubSub.close` method and the
        # message retrieval method should NOT be called concurrently.
        #
        # Due to the restriction above, the PubSub cleanup logic happens inside the consumer thread.
        if listener is not None and listener.is_alive():
            listener.join(timeout=2)

    def _unblock_message_iterator(self) -> None:
        try:
            self._queue.put_nowait(SIG_CLOSE)
        except queue.Full:
            try:
                self._queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self._queue.put_nowait(SIG_CLOSE)
            except queue.Full:
                pass

    # Abstract methods to be implemented by subclasses
    def _get_subscription_type(self) -> str:
        """Return the subscription type (e.g., 'regular' or 'sharded')."""
        raise NotImplementedError

    def _publish_close_event(self) -> None:
        """Publish a control event on the Redis channel to unblock the listener.

        This is called by close() after setting _closed. The subclass should
        publish an empty message on the same topic so that a blocking
        get_message() call in the listener thread returns promptly.
        """
        raise NotImplementedError

    def _subscribe(self) -> None:
        """Subscribe to the Redis topic using the appropriate command."""
        raise NotImplementedError

    def _unsubscribe(self) -> None:
        """Unsubscribe from the Redis topic using the appropriate command."""
        raise NotImplementedError

    def _get_message(self) -> dict[str, Any] | None:
        """Get a message from Redis using the appropriate method."""
        raise NotImplementedError

    def _get_message_type(self) -> str:
        """Return the expected message type (e.g., 'message' or 'smessage')."""
        raise NotImplementedError
