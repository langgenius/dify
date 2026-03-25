from __future__ import annotations

import logging
import queue
import threading
from collections.abc import Iterator
from typing import Self

from libs.broadcast_channel.channel import Producer, Subscriber, Subscription
from libs.broadcast_channel.exc import SubscriptionClosedError
from redis import Redis, RedisCluster

logger = logging.getLogger(__name__)


class StreamsBroadcastChannel:
    """
    Redis Streams based broadcast channel implementation.

    Characteristics:
    - At-least-once delivery for late subscribers within the stream retention window.
    - Each topic is stored as a dedicated Redis Stream key.
    - The stream key expires `retention_seconds` after the last event is published (to bound storage).
    """

    def __init__(self, redis_client: Redis | RedisCluster, *, retention_seconds: int = 600):
        self._client = redis_client
        self._retention_seconds = max(int(retention_seconds or 0), 0)

    def topic(self, topic: str) -> StreamsTopic:
        return StreamsTopic(self._client, topic, retention_seconds=self._retention_seconds)


class StreamsTopic:
    def __init__(self, redis_client: Redis | RedisCluster, topic: str, *, retention_seconds: int = 600):
        self._client = redis_client
        self._topic = topic
        self._key = f"stream:{topic}"
        self._retention_seconds = retention_seconds
        self.max_length = 5000

    def as_producer(self) -> Producer:
        return self

    def publish(self, payload: bytes) -> None:
        self._client.xadd(self._key, {b"data": payload}, maxlen=self.max_length)
        if self._retention_seconds > 0:
            try:
                self._client.expire(self._key, self._retention_seconds)
            except Exception as e:
                logger.warning("Failed to set expire for stream key %s: %s", self._key, e, exc_info=True)

    def as_subscriber(self) -> Subscriber:
        return self

    def subscribe(self) -> Subscription:
        return _StreamsSubscription(self._client, self._key)


class _StreamsSubscription(Subscription):
    _SENTINEL = object()

    def __init__(self, client: Redis | RedisCluster, key: str):
        self._client = client
        self._key = key

        self._queue: queue.Queue[object] = queue.Queue()

        # The `_lock` lock is used to
        #
        # 1. protect the _listener attribute
        # 2. prevent repeated releases of underlying resoueces. (The _closed flag.)
        #
        # INVARIANT: the implementation must hold the lock while
        # reading and writing the _listener / `_closed` attribute.
        self._lock = threading.Lock()
        self._closed: bool = False
        # self._closed = threading.Event()
        self._listener: threading.Thread | None = None

    def _listen(self) -> None:
        """The `_listen` method handles the message retrieval loop. It requires a dedicated thread
        and is not intended for direct invocation.

        The thread is started by `_start_if_needed`.
        """

        # since this method runs in a dedicated thread, acquiring `_lock` inside this method won't cause
        # deadlock.

        # Setting initial last id to `$` to signal redis that we only want new messages.
        #
        # ref: https://redis.io/docs/latest/commands/xread/#the-special--id
        last_id = "$"
        try:
            while True:
                with self._lock:
                    if self._closed:
                        break
                streams = self._client.xread({self._key: last_id}, block=1000, count=100)
                if not streams:
                    continue

                for _, entries in streams:
                    for entry_id, fields in entries:
                        data = None
                        if isinstance(fields, dict):
                            data = fields.get(b"data")
                        data_bytes: bytes | None = None
                        if isinstance(data, str):
                            data_bytes = data.encode()
                        elif isinstance(data, (bytes, bytearray)):
                            data_bytes = bytes(data)
                        if data_bytes is not None:
                            self._queue.put_nowait(data_bytes)
                        last_id = entry_id
        finally:
            self._queue.put_nowait(self._SENTINEL)
            with self._lock:
                self._listener = None
                self._closed = True

    def _start_if_needed(self) -> None:
        """This method must be called with `_lock` held."""
        if self._listener is not None:
            return
        # Ensure only one listener thread is created under concurrent calls
        if self._listener is not None or self._closed:
            return
        self._listener = threading.Thread(
            target=self._listen,
            name=f"redis-streams-sub-{self._key}",
            daemon=True,
        )
        self._listener.start()

    def __iter__(self) -> Iterator[bytes]:
        # Iterator delegates to receive with timeout; stops on closure.
        with self._lock:
            self._start_if_needed()

        while True:
            with self._lock:
                if self._closed:
                    return
            try:
                item = self.receive(timeout=1)
            except SubscriptionClosedError:
                return
            if item is not None:
                yield item

    def receive(self, timeout: float | None = 0.1) -> bytes | None:
        with self._lock:
            if self._closed:
                raise SubscriptionClosedError("The Redis streams subscription is closed")
            self._start_if_needed()

        try:
            if timeout is None:
                item = self._queue.get()
            else:
                item = self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

        if item is self._SENTINEL:
            raise SubscriptionClosedError("The Redis streams subscription is closed")
        assert isinstance(item, (bytes, bytearray)), "Unexpected item type in stream queue"
        return bytes(item)

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            listener = self._listener
            if listener is not None:
                self._listener = None
        # We close the listener outside of the with block to avoid holding the
        # lock for a long time.
        if listener is not None and listener.is_alive():
            listener.join(timeout=2.0)
            if listener.is_alive():
                logger.warning(
                    "Streams subscription listener for key %s did not stop within timeout; keeping reference.",
                    self._key,
                )

    # Context manager helpers
    def __enter__(self) -> Self:
        with self._lock:
            self._start_if_needed()
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> bool | None:
        self.close()
        return None
