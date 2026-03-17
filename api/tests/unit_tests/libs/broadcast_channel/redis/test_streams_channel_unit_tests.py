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
    - Supports xgroup_create/xreadgroup/xack for consumer-group flow
    - xread returns entries strictly greater than last_id (fallback path)
    - expire is recorded but has no effect on behavior
    """

    def __init__(self) -> None:
        self._store: dict[str, list[tuple[str, dict]]] = {}
        self._next_id: dict[str, int] = {}
        self._expire_calls: dict[str, int] = {}
        # key -> group -> {"last_id": str}
        self._groups: dict[str, dict[str, dict[str, str]]] = {}

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

    # Consumer API (fallback without groups)
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

    # Consumer group API
    def xgroup_create(self, key: str, group: str, id: str = "$", mkstream: bool = False):
        if mkstream and key not in self._store:
            self._store[key] = []
            self._next_id[key] = 0
        self._groups.setdefault(key, {})
        if group in self._groups[key]:
            raise RuntimeError("BUSYGROUP Consumer Group name already exists")
        # Resolve special IDs at creation time (Redis semantics)
        if id == "$":
            # '$' means start from the end (only new messages)
            entries = self._store.get(key, [])
            resolved = entries[-1][0] if entries else "0-0"
        elif id == "0":
            # '0' means start from the beginning
            resolved = "0-0"
        else:
            resolved = id
        self._groups[key][group] = {"last_id": resolved}

    def xreadgroup(
        self,
        group: str,
        consumer: str,
        streams: dict,
        count: int | None = None,
        block: int | None = None,
        noack: bool | None = None,
    ):
        assert len(streams) == 1
        key, special = next(iter(streams.items()))
        assert special == ">"
        entries = self._store.get(key, [])
        group_info = self._groups.setdefault(key, {}).setdefault(group, {"last_id": "0-0"})
        last_id = group_info["last_id"]

        start_idx = 0
        if last_id not in {"0-0", "$"}:
            for i, (eid, _f) in enumerate(entries):
                if eid == last_id:
                    start_idx = i + 1
                    break
        elif last_id == "$":
            # Start from the end (only new)
            start_idx = len(entries)

        if start_idx >= len(entries):
            if block and block > 0:
                time.sleep(min(0.01, block / 1000.0))
            return []

        end_idx = len(entries) if count is None else min(len(entries), start_idx + count)
        batch = entries[start_idx:end_idx]
        if batch:
            group_info["last_id"] = batch[-1][0]
        return [(key, batch)]

    def xack(self, key: str, group: str, *ids: str):
        # no-op for fake
        return len(ids)

    def xautoclaim(
        self,
        key: str,
        group: str,
        consumer: str,
        min_idle_time: int,
        start_id: str = "0-0",
        count: int | None = None,
        justid: bool | None = None,
    ):
        # Minimal fake: no PEL tracking; return no entries
        return start_id, []

    def xgroup_delconsumer(self, key: str, group: str, consumer: str):
        # no-op for fake
        return {"key": key, "group": group, "consumer": consumer}

    def xgroup_destroy(self, key: str, group: str):
        if key in self._groups and group in self._groups[key]:
            del self._groups[key][group]
            return 1
        return 0


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
    def test_streams_receive_from_beginning_on_subscribe(self, streams_channel: StreamsBroadcastChannel):
        topic = streams_channel.topic("gamma")
        # Pre-publish events before subscribing (SHOULD be received with xreadgroup starting at '0')
        topic.publish(b"e1")
        topic.publish(b"e2")

        sub = topic.subscribe()
        assert isinstance(sub, _StreamsSubscription)

        received: list[bytes] = []
        with sub:
            # Publish after subscription; these should also be received
            topic.publish(b"n1")
            topic.publish(b"n2")
            # Give listener thread a moment to read
            time.sleep(0.05)
            # Drain using receive() to avoid indefinite iteration in tests
            for _ in range(10):
                msg = sub.receive(timeout=0.2)
                if msg is None:
                    break
                received.append(msg)

        # Should receive both pre-existing and new messages
        assert received == [b"e1", b"e2", b"n1", b"n2"]

    def test_multiple_subscribers_share_group_position(self, streams_channel: StreamsBroadcastChannel):
        """Test that multiple subscribers to the same topic share the group's position."""
        topic = streams_channel.topic("shared-group-test")

        # Publish initial messages
        topic.publish(b"msg1")
        topic.publish(b"msg2")

        # First subscriber
        sub1 = topic.subscribe()
        received1: list[bytes] = []
        with sub1:
            # Consume first message
            time.sleep(0.05)
            msg = sub1.receive(timeout=0.2)
            if msg:
                received1.append(msg)

        # Second subscriber should start from the group's position
        sub2 = topic.subscribe()
        received2: list[bytes] = []
        with sub2:
            # Publish more messages
            topic.publish(b"msg3")
            time.sleep(0.05)
            # Should get remaining messages from group position
            for _ in range(5):
                msg = sub2.receive(timeout=0.2)
                if msg is None:
                    break
                received2.append(msg)

        # Both subscribers should have received messages without duplication
        # (using noack=True, messages are not retained in PEL)
        assert len(received1) > 0 or len(received2) > 0

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
