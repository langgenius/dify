from __future__ import annotations

import logging
import queue
import threading
from collections.abc import Iterator
from typing import Protocol, Self, cast, override

from extensions.redis_names import serialize_redis_name
from libs.broadcast_channel.channel import CursorMessage, CursorSubscription, Producer, Subscriber
from libs.broadcast_channel.cursor import normalize_stream_cursor
from libs.broadcast_channel.exc import SubscriptionClosedError
from libs.broadcast_channel.signals import SIG_CLOSE
from redis import Redis, RedisCluster

logger = logging.getLogger(__name__)

_XADD_WITH_EXPIRE_LUA = """
local entry_id = redis.call('XADD', KEYS[1], '*', 'data', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return entry_id
"""


class _RedisLuaClient(Protocol):
    def eval(self, script: str, numkeys: int, *keys_and_args: str | bytes | int) -> object: ...


class StreamsBroadcastChannel:
    """
    Redis Streams based broadcast channel implementation.

    Characteristics:
    - At-least-once delivery for late subscribers within the stream retention window.
    - Each topic is stored as a dedicated Redis Stream key.
    - The stream key expires `retention_seconds` after the last event is published (to bound storage).
    """

    def __init__(
        self,
        redis_client: Redis | RedisCluster,
        *,
        retention_seconds: int = 600,
    ):
        self._client = redis_client
        self._retention_seconds = max(retention_seconds, 0)

    def topic(self, topic: str) -> StreamsTopic:
        return StreamsTopic(
            self._client,
            topic,
            retention_seconds=self._retention_seconds,
        )


class StreamsTopic:
    def __init__(
        self,
        redis_client: Redis | RedisCluster,
        topic: str,
        *,
        retention_seconds: int = 600,
    ):
        self._client = redis_client
        self._topic = topic
        self._key = serialize_redis_name(f"stream:{topic}")
        self._retention_seconds = retention_seconds

    def as_producer(self) -> Producer:
        return self

    def publish(self, payload: bytes) -> None:
        # Retention is bounded by key expiry rather than MAXLEN.  Trimming a
        # live per-run stream could silently invalidate a reconnect cursor.
        if self._retention_seconds > 0:
            # A single-key Lua command is atomic on both standalone Redis and
            # Redis Cluster. A process exit cannot leave a newly appended
            # stream without its TTL, and failures propagate to the publisher
            # instead of silently creating an immortal event log.
            cast(_RedisLuaClient, self._client).eval(
                _XADD_WITH_EXPIRE_LUA,
                1,
                self._key,
                payload,
                self._retention_seconds,
            )
            return
        self._client.xadd(self._key, {b"data": payload})

    def as_subscriber(self) -> Subscriber:
        return self

    def subscribe(self, *, cursor: str | None = None) -> CursorSubscription:
        # A new subscriber replays the retained per-run log.  XREAD is strictly
        # greater-than, so a Last-Event-ID can be passed through without
        # duplicating the event the client already acknowledged.
        start_cursor = "0-0" if cursor is None else normalize_stream_cursor(cursor)
        return _StreamsSubscription(self._client, self._key, cursor=start_cursor)

    def earliest_cursor(self) -> str | None:
        entries = self._client.xrange(self._key, count=1)
        if not entries:
            return None
        entry_id, _ = entries[0]
        return normalize_stream_cursor(entry_id)

    def latest_cursor(self) -> str | None:
        entries = self._client.xrevrange(self._key, count=1)
        if not entries:
            return None
        entry_id, _ = entries[0]
        return normalize_stream_cursor(entry_id)


class _StreamsSubscription(CursorSubscription):
    _SENTINEL = object()

    def __init__(self, client: Redis | RedisCluster, key: str, *, cursor: str = "0-0"):
        self._client = client
        self._key = key
        self._cursor = normalize_stream_cursor(cursor)

        self._queue: queue.Queue[CursorMessage | object] = queue.Queue()

        # The `_lock` lock is used to
        #
        # 1. protect the _listener attribute
        # 2. prevent repeated releases of underlying resoueces. (The _closed flag.)
        #
        # INVARIANT: the implementation must hold the lock while
        # reading and writing the _listener / `_closed` attribute.
        self._lock = threading.Lock()
        self._closed: bool = False
        self._listener: threading.Thread | None = None

    def _listen(self) -> None:
        """The `_listen` method handles the message retrieval loop. It requires a dedicated thread
        and is not intended for direct invocation.

        The thread is started by `_start_if_needed`.
        """

        # since this method runs in a dedicated thread, acquiring `_lock` inside this method won't cause
        # deadlock.

        last_id = self._cursor
        try:
            while True:
                with self._lock:
                    if self._closed:
                        break
                # A short bounded block lets close() remain purely local while
                # still releasing the listener promptly.
                streams = self._client.xread({self._key: last_id}, block=100, count=100)
                if not streams:
                    continue

                for _, entries in streams:
                    for entry_id, fields in entries:
                        cursor = normalize_stream_cursor(entry_id)
                        # Advance over malformed/legacy control entries as well;
                        # otherwise the next XREAD would return them forever.
                        last_id = cursor
                        data = None
                        if isinstance(fields, dict):
                            data = fields.get(b"data")
                        data_bytes: bytes | None = None
                        match data:
                            case str():
                                data_bytes = data.encode()
                            case bytes() | bytearray():
                                data_bytes = bytes(data)
                        if data_bytes is not None:
                            if data_bytes == SIG_CLOSE:
                                continue
                            self._queue.put_nowait(CursorMessage(payload=data_bytes, cursor=cursor))
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

    @override
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

    @override
    def receive(self, timeout: float | None = 0.1) -> bytes | None:
        message = self.receive_with_cursor(timeout=timeout)
        return None if message is None else message.payload

    @override
    def receive_with_cursor(self, timeout: float | None = 0.1) -> CursorMessage | None:
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
        assert isinstance(item, CursorMessage), "Unexpected item type in stream queue"
        return item

    @override
    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            listener = self._listener
            if listener is not None:
                self._listener = None

        # Wake local consumers immediately.  The Redis XREAD call uses a
        # bounded short poll and observes _closed without writing a
        # shared marker into the stream.
        self._queue.put_nowait(self._SENTINEL)

        if listener is not None and listener.is_alive():
            listener.join(timeout=2)
            if listener.is_alive():
                logger.debug(
                    "Streams subscription listener for key %s did not stop after join; "
                    "daemon thread will exit on its own within one poll window.",
                    self._key,
                )

    # Context manager helpers
    @override
    def __enter__(self) -> Self:
        with self._lock:
            self._start_if_needed()
        return self

    @override
    def __exit__(self, exc_type, exc_value, traceback) -> bool | None:
        self.close()
        return None
