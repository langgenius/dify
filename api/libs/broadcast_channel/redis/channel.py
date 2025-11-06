import logging
import queue
import threading
import types
from collections.abc import Generator, Iterator
from typing import Self

from libs.broadcast_channel.channel import Producer, Subscriber, Subscription
from libs.broadcast_channel.exc import SubscriptionClosedError
from redis import Redis
from redis.client import PubSub

_logger = logging.getLogger(__name__)


class BroadcastChannel:
    """
    Redis Pub/Sub based broadcast channel implementation.

    Provides "at most once" delivery semantics for messages published to channels.
    Uses Redis PUBLISH/SUBSCRIBE commands for real-time message delivery.

    The `redis_client` used to construct BroadcastChannel should have `decode_responses` set to `False`.
    """

    def __init__(
        self,
        redis_client: Redis,
    ):
        self._client = redis_client

    def topic(self, topic: str) -> "Topic":
        return Topic(self._client, topic)


class Topic:
    def __init__(self, redis_client: Redis, topic: str):
        self._client = redis_client
        self._topic = topic

    def as_producer(self) -> Producer:
        return self

    def publish(self, payload: bytes) -> None:
        self._client.publish(self._topic, payload)

    def as_subscriber(self) -> Subscriber:
        return self

    def subscribe(self) -> Subscription:
        return _RedisSubscription(
            pubsub=self._client.pubsub(),
            topic=self._topic,
        )


class _RedisSubscription(Subscription):
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
        with self._start_lock:
            if self._started:
                return
            if self._closed.is_set():
                raise SubscriptionClosedError("The Redis subscription is closed")
            if self._pubsub is None:
                raise SubscriptionClosedError("The Redis subscription has been cleaned up")

            self._pubsub.subscribe(self._topic)
            _logger.debug("Subscribed to channel %s", self._topic)

            self._listener_thread = threading.Thread(
                target=self._listen,
                name=f"redis-broadcast-{self._topic}",
                daemon=True,
            )
            self._listener_thread.start()
            self._started = True

    def _listen(self) -> None:
        pubsub = self._pubsub
        assert pubsub is not None, "PubSub should not be None while starting listening."
        while not self._closed.is_set():
            raw_message = pubsub.get_message(ignore_subscribe_messages=True, timeout=0.1)

            if raw_message is None:
                continue

            if raw_message.get("type") != "message":
                continue

            channel_field = raw_message.get("channel")
            if isinstance(channel_field, bytes):
                channel_name = channel_field.decode("utf-8")
            elif isinstance(channel_field, str):
                channel_name = channel_field
            else:
                channel_name = str(channel_field)

            if channel_name != self._topic:
                _logger.warning("Ignoring message from unexpected channel %s", channel_name)
                continue

            payload_bytes: bytes | None = raw_message.get("data")
            if not isinstance(payload_bytes, bytes):
                _logger.error("Received invalid data from channel %s, type=%s", self._topic, type(payload_bytes))
                continue

            self._enqueue_message(payload_bytes)

        _logger.debug("Listener thread stopped for channel %s", self._topic)
        pubsub.unsubscribe(self._topic)
        pubsub.close()
        _logger.debug("PubSub closed for topic %s", self._topic)
        self._pubsub = None

    def _enqueue_message(self, payload: bytes) -> None:
        while not self._closed.is_set():
            try:
                self._queue.put_nowait(payload)
                return
            except queue.Full:
                try:
                    self._queue.get_nowait()
                    self._dropped_count += 1
                    _logger.debug(
                        "Dropped message from Redis subscription, topic=%s, total_dropped=%d",
                        self._topic,
                        self._dropped_count,
                    )
                except queue.Empty:
                    continue
        return

    def _message_iterator(self) -> Generator[bytes, None, None]:
        while not self._closed.is_set():
            try:
                item = self._queue.get(timeout=0.1)
            except queue.Empty:
                continue

            yield item

    def __iter__(self) -> Iterator[bytes]:
        if self._closed.is_set():
            raise SubscriptionClosedError("The Redis subscription is closed")
        self._start_if_needed()
        return iter(self._message_iterator())

    def receive(self, timeout: float | None = None) -> bytes | None:
        if self._closed.is_set():
            raise SubscriptionClosedError("The Redis subscription is closed")
        self._start_if_needed()

        try:
            item = self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

        return item

    def __enter__(self) -> Self:
        self._start_if_needed()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: types.TracebackType | None,
    ) -> bool | None:
        self.close()
        return None

    def close(self) -> None:
        if self._closed.is_set():
            return

        self._closed.set()
        # NOTE: PubSub is not thread-safe. More specifically, the `PubSub.close` method and the `PubSub.get_message`
        # method should NOT be called concurrently.
        #
        # Due to the restriction above, the PubSub cleanup logic happens inside the consumer thread.
        listener = self._listener_thread
        if listener is not None:
            listener.join(timeout=1.0)
            self._listener_thread = None
