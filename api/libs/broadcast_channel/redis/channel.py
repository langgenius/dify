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
from redis.exceptions import RedisError

_logger = logging.getLogger(__name__)


def _get_redis_version(redis_client: Redis) -> tuple[int, int, int]:
    """
    Get Redis server version.

    Returns:
        A tuple of (major, minor, patch) version numbers.
    """
    try:
        info = redis_client.info()
        redis_version_str = info.get("redis_version", "0.0.0")
        version_parts = redis_version_str.split(".")

        major = int(version_parts[0]) if len(version_parts) > 0 else 0
        minor = int(version_parts[1]) if len(version_parts) > 1 else 0
        patch = int(version_parts[2].split("-")[0]) if len(version_parts) > 2 else 0

        return (major, minor, patch)
    except (RedisError, ValueError, IndexError) as e:
        _logger.warning("Failed to detect Redis version, assuming < 7.0: %s", e)
        return (0, 0, 0)


def _supports_sharded_pubsub(redis_client: Redis, version: tuple[int, int, int] | None = None) -> bool:
    """
    Check if Redis server supports sharded pub/sub (SPUBLISH/SSUBSCRIBE).

    Sharded pub/sub was introduced in Redis 7.0.

    Args:
        redis_client: The Redis client instance.
        version: Optional pre-fetched version tuple to avoid duplicate INFO calls.

    Returns:
        True if Redis 7.0+, False otherwise.
    """
    if version is not None:
        major, _, _ = version
    else:
        major, _, _ = _get_redis_version(redis_client)
    return major >= 7


class BroadcastChannel:
    """
    Redis Pub/Sub based broadcast channel implementation.

    Provides "at most once" delivery semantics for messages published to channels.
    Uses Redis PUBLISH/SUBSCRIBE commands for real-time message delivery.
    For Redis 7.0+, automatically uses SPUBLISH/SSUBSCRIBE for better performance
    and scalability in cluster environments.

    The `redis_client` used to construct BroadcastChannel should have `decode_responses` set to `False`.
    """

    def __init__(
        self,
        redis_client: Redis,
        use_sharded_pubsub: bool | None = None,
    ):
        """
        Initialize BroadcastChannel.

        Args:
            redis_client: Redis client instance with decode_responses=False.
            use_sharded_pubsub: Force enable/disable sharded pub/sub. If None,
                              automatically detects based on Redis version.
        """
        self._client = redis_client

        # Cache version information to avoid duplicate INFO calls
        self._redis_version = _get_redis_version(redis_client)

        if use_sharded_pubsub is not None:
            self._use_sharded_pubsub = use_sharded_pubsub
        else:
            self._use_sharded_pubsub = _supports_sharded_pubsub(redis_client, self._redis_version)

        # Use cached version information for logging
        if self._use_sharded_pubsub:
            major, minor, patch = self._redis_version
            _logger.info(
                "BroadcastChannel using sharded pub/sub (SPUBLISH/SSUBSCRIBE) on Redis %d.%d.%d", major, minor, patch
            )
        else:
            _logger.debug("BroadcastChannel using standard pub/sub (PUBLISH/SUBSCRIBE)")

    def topic(self, topic: str) -> "Topic":
        return Topic(self._client, topic, self._use_sharded_pubsub)


class Topic:
    def __init__(self, redis_client: Redis, topic: str, use_sharded_pubsub: bool):
        self._client = redis_client
        self._topic = topic
        self._use_sharded_pubsub = use_sharded_pubsub

    def as_producer(self) -> Producer:
        return self

    def publish(self, payload: bytes) -> None:
        """
        Publish a message to the topic.

        Uses SPUBLISH if Redis 7.0+ and sharded pub/sub is enabled,
        otherwise falls back to standard PUBLISH.

        Args:
            payload: The message payload to publish.
        """
        if self._use_sharded_pubsub:
            try:
                # Try to use SPUBLISH for Redis 7.0+
                self._client.execute_command("SPUBLISH", self._topic, payload)
                _logger.debug("Published message using SPUBLISH to topic %s", self._topic)
                return
            except RedisError as e:
                if "unknown command" in str(e).lower():
                    # Fallback to PUBLISH if SPUBLISH is not supported
                    _logger.warning("SPUBLISH not supported, falling back to PUBLISH: %s", e)
                else:
                    # Re-raise other Redis errors
                    raise

        # Use standard PUBLISH for Redis < 7.0 or when sharded pub/sub is disabled/unsupported
        self._client.publish(self._topic, payload)
        _logger.debug("Published message using PUBLISH to topic %s", self._topic)

    def as_subscriber(self) -> Subscriber:
        return self

    def subscribe(self) -> Subscription:
        """
        Create a subscription to the topic.

        Uses SSUBSCRIBE if Redis 7.0+ and sharded pub/sub is enabled,
        otherwise falls back to standard SUBSCRIBE.

        Returns:
            A subscription instance that can be used to receive messages.
        """
        return _RedisSubscription(
            redis_client=self._client,
            topic=self._topic,
            use_sharded_pubsub=self._use_sharded_pubsub,
        )


class _RedisSubscription(Subscription):
    def __init__(
        self,
        redis_client: Redis,
        topic: str,
        use_sharded_pubsub: bool,
    ):
        # The _pubsub is None only if the subscription is closed.
        self._redis_client = redis_client
        self._pubsub: PubSub | None = None
        self._topic = topic
        self._use_sharded_pubsub = use_sharded_pubsub
        self._closed = threading.Event()
        self._queue: queue.Queue[bytes] = queue.Queue(maxsize=1024)
        self._dropped_count = 0
        self._listener_thread: threading.Thread | None = None
        self._start_lock = threading.Lock()
        self._started = False
        self._subscription_mode: str | None = None  # Will be set to 'sharded' or 'standard'

    def _start_if_needed(self) -> None:
        with self._start_lock:
            if self._started:
                return
            if self._closed.is_set():
                raise SubscriptionClosedError("The Redis subscription is closed")

            # _pubsub is None initially, which is the expected state before starting
            # We create the pubsub instance here

            # Try to use SSUBSCRIBE if sharded pub/sub is enabled
            self._pubsub = self._redis_client.pubsub()
            if self._use_sharded_pubsub:
                try:
                    self._pubsub.execute_command("SSUBSCRIBE", self._topic)
                    self._subscription_mode = "sharded"
                    _logger.debug("Subscribed to sharded channel %s using SSUBSCRIBE", self._topic)
                except RedisError as e:
                    if "unknown command" in str(e).lower():
                        # Fallback to standard SUBSCRIBE if SSUBSCRIBE is not supported
                        _logger.warning("SSUBSCRIBE not supported, falling back to SUBSCRIBE: %s", e)
                        self._pubsub.subscribe(self._topic)
                        self._subscription_mode = "standard"
                        _logger.debug("Subscribed to channel %s using SUBSCRIBE (fallback)", self._topic)
                    else:
                        # Re-raise other Redis errors
                        raise
            else:
                # Use standard SUBSCRIBE for Redis < 7.0 or when sharded pub/sub is disabled
                self._pubsub.subscribe(self._topic)
                self._subscription_mode = "standard"
                _logger.debug("Subscribed to channel %s using SUBSCRIBE", self._topic)

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

            # Handle both sharded and standard message types
            message_type = raw_message.get("type")
            if message_type not in ("message", "smessage"):
                continue

            channel_field = raw_message.get("channel")
            if isinstance(channel_field, bytes):
                channel_name = channel_field.decode("utf-8")
            elif isinstance(channel_field, str):
                channel_name = channel_field
            else:
                channel_name = str(channel_field)

            if channel_name != self._topic:
                _logger.warning("Ignoring message from unexpected channel %s (type: %s)", channel_name, message_type)
                continue

            payload_bytes: bytes | None = raw_message.get("data")
            if not isinstance(payload_bytes, bytes):
                _logger.error(
                    "Received invalid data from channel %s, type=%s, payload_type=%s",
                    self._topic,
                    message_type,
                    type(payload_bytes),
                )
                continue

            self._enqueue_message(payload_bytes)

        _logger.debug("Listener thread stopped for channel %s (mode: %s)", self._topic, self._subscription_mode)

        # Use appropriate unsubscribe command based on subscription mode
        if self._subscription_mode == "sharded":
            try:
                pubsub.execute_command("SUNSUBSCRIBE", self._topic)
            except RedisError as e:
                _logger.warning("Failed to SUNSUBSCRIBE from %s: %s", self._topic, e)
        else:
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
        if listener is not None and listener.is_alive():
            listener.join(timeout=1.0)
            self._listener_thread = None
