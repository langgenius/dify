import time

import pytest

from libs.broadcast_channel.redis.streams_channel import (
    StreamsBroadcastChannel,
    StreamsTopic,
    _StreamsSubscription,
)


class FakeStreamsRedis:
    """Minimal in-memory Redis Streams stub for unit tests.

    - Stores entries per key as [(id, {b"data": bytes}), ...]
    - xadd appends entries and returns an auto-increment id like "1-0"
    - xread returns entries strictly greater than last_id
    - expire is recorded but has no effect on behavior
    """

    def __init__(self) -> None:
        self._store: dict[str, list[tuple[str, dict]]] = {}
        self._next_id: dict[str, int] = {}
        self._expire_calls: dict[str, int] = {}

    # Publisher API
    def xadd(self, key: str, fields: dict, *, maxlen: int | None = None) -> str:
        """Append entry to stream; accept optional maxlen for API compatibility.

        The test double ignores maxlen trimming semantics; only records the entry.
        """
        n = self._next_id.get(key, 0) + 1
        self._next_id[key] = n
        entry_id = f"{n}-0"
        self._store.setdefault(key, []).append((entry_id, fields))
        return entry_id

    def expire(self, key: str, seconds: int) -> None:
        self._expire_calls[key] = self._expire_calls.get(key, 0) + 1

    # Consumer API
    def xread(self, streams: dict, block: int | None = None, count: int | None = None):
        # Expect a single key
        assert len(streams) == 1
        key, last_id = next(iter(streams.items()))
        entries = self._store.get(key, [])

        # Find position strictly greater than last_id
        start_idx = 0
        if last_id != "0-0":
            for i, (eid, _f) in enumerate(entries):
                if eid == last_id:
                    start_idx = i + 1
                    break
        if start_idx >= len(entries):
            # Simulate blocking wait (bounded) if requested
            if block and block > 0:
                time.sleep(min(0.01, block / 1000.0))
            return []

        end_idx = len(entries) if count is None else min(len(entries), start_idx + count)
        batch = entries[start_idx:end_idx]
        return [(key, batch)]


@pytest.fixture
def fake_redis() -> FakeStreamsRedis:
    return FakeStreamsRedis()


@pytest.fixture
def streams_channel(fake_redis: FakeStreamsRedis) -> StreamsBroadcastChannel:
    return StreamsBroadcastChannel(fake_redis, retention_seconds=60)


class TestStreamsBroadcastChannel:
    def test_topic_creation(self, streams_channel: StreamsBroadcastChannel, fake_redis: FakeStreamsRedis):
        topic = streams_channel.topic("alpha")
        assert isinstance(topic, StreamsTopic)
        assert topic._client is fake_redis
        assert topic._topic == "alpha"
        assert topic._key == "stream:alpha"

    def test_publish_calls_xadd_and_expire(
        self,
        streams_channel: StreamsBroadcastChannel,
        fake_redis: FakeStreamsRedis,
    ):
        topic = streams_channel.topic("beta")
        payload = b"hello"
        topic.publish(payload)
        # One entry stored under stream key (bytes key for payload field)
        assert fake_redis._store["stream:beta"][0][1] == {b"data": payload}
        # Expire called after publish
        assert fake_redis._expire_calls.get("stream:beta", 0) >= 1


class TestStreamsSubscription:
    def test_subscribe_and_receive_from_beginning(self, streams_channel: StreamsBroadcastChannel):
        topic = streams_channel.topic("gamma")
        # Pre-publish events before subscribing (late subscriber)
        topic.publish(b"e1")
        topic.publish(b"e2")

        sub = topic.subscribe()
        assert isinstance(sub, _StreamsSubscription)

        received: list[bytes] = []
        with sub:
            # Give listener thread a moment to xread
            time.sleep(0.05)
            # Drain using receive() to avoid indefinite iteration in tests
            for _ in range(5):
                msg = sub.receive(timeout=0.1)
                if msg is None:
                    break
                received.append(msg)

        assert received == [b"e1", b"e2"]

    def test_receive_timeout_returns_none(self, streams_channel: StreamsBroadcastChannel):
        topic = streams_channel.topic("delta")
        sub = topic.subscribe()
        with sub:
            # No messages yet
            assert sub.receive(timeout=0.05) is None

    def test_close_stops_listener(self, streams_channel: StreamsBroadcastChannel):
        topic = streams_channel.topic("epsilon")
        sub = topic.subscribe()
        with sub:
            # Listener running; now close and ensure no crash
            sub.close()
            # After close, receive should raise SubscriptionClosedError
            from libs.broadcast_channel.exc import SubscriptionClosedError

            with pytest.raises(SubscriptionClosedError):
                sub.receive()

    def test_no_expire_when_zero_retention(self, fake_redis: FakeStreamsRedis):
        channel = StreamsBroadcastChannel(fake_redis, retention_seconds=0)
        topic = channel.topic("zeta")
        topic.publish(b"payload")
        # No expire recorded when retention is disabled
        assert fake_redis._expire_calls.get("stream:zeta") is None
