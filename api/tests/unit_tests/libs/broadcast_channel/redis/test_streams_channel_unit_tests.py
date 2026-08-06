import threading
import time
from dataclasses import dataclass
from typing import Any, cast
from unittest.mock import patch

import pytest

from libs.broadcast_channel.channel import CursorMessage
from libs.broadcast_channel.exc import SubscriptionClosedError
from libs.broadcast_channel.redis.streams_channel import (
    StreamsBroadcastChannel,
    StreamsTopic,
    _StreamsSubscription,
)
from libs.broadcast_channel.signals import SIG_CLOSE


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
        self._dollar_snapshots: dict[str, int] = {}

    # Publisher API
    def xadd(self, key: str, fields: dict[str, Any], *, maxlen: int | None = None) -> str:
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

    def eval(self, script: str, numkeys: int, key: str, payload: bytes, retention_seconds: int) -> str:
        assert "XADD" in script
        assert "EXPIRE" in script
        assert numkeys == 1
        entry_id = self.xadd(key, {b"data": payload})
        self.expire(key, retention_seconds)
        return entry_id

    # Consumer API
    def xread(self, streams: dict[str, Any], block: int | None = None, count: int | None = None):
        # Expect a single key
        assert len(streams) == 1
        key, last_id = next(iter(streams.items()))
        entries = self._store.get(key, [])

        # Find position strictly greater than last_id
        start_idx = 0
        if last_id == "$":
            start_idx = self._dollar_snapshots.setdefault(key, len(entries))
        elif last_id != "0-0":
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

    def xrange(self, key: str, *, count: int | None = None):
        entries = self._store.get(key, [])
        return entries if count is None else entries[:count]

    def xrevrange(self, key: str, *, count: int | None = None):
        entries = list(reversed(self._store.get(key, [])))
        return entries if count is None else entries[:count]


class FailExpireRedis(FakeStreamsRedis):
    def expire(self, key: str, seconds: int) -> None:
        raise RuntimeError("expire failed")


class BlockingRedis:
    """A Redis mock whose xread blocks until a control event is xadd-ed."""

    def __init__(self) -> None:
        self._release = threading.Event()
        self._store: dict[str, list[tuple[str, dict]]] = {}
        self._next_id: dict[str, int] = {}

    def xadd(self, key: str, fields: dict[str, Any], *, maxlen: int | None = None) -> str:
        n = self._next_id.get(key, 0) + 1
        self._next_id[key] = n
        entry_id = f"{n}-0"
        self._store.setdefault(key, []).append((entry_id, fields))
        self._release.set()  # Wake up any blocked xread
        return entry_id

    def xread(self, streams: dict[str, Any], block: int | None = None, count: int | None = None):
        self._release.wait(timeout=block / 1000.0 if block else None)
        key = next(iter(streams))
        entries = self._store.get(key, [])
        if entries:
            self._store[key] = []  # Consume entries
            return [(key, entries)]
        return []

    def release(self) -> None:
        self._release.set()


@dataclass(frozen=True)
class ListenPayloadCase:
    name: str
    fields: object
    expected_messages: list[bytes]


def build_listen_payload_cases() -> list[ListenPayloadCase]:
    return [
        ListenPayloadCase(
            name="string_payload_is_encoded",
            fields={b"data": "hello"},
            expected_messages=[b"hello"],
        ),
        ListenPayloadCase(
            name="bytearray_payload_is_converted",
            fields={b"data": bytearray(b"world")},
            expected_messages=[b"world"],
        ),
        ListenPayloadCase(
            name="non_dict_fields_are_ignored",
            fields=[("data", b"ignored")],
            expected_messages=[],
        ),
        ListenPayloadCase(
            name="missing_payload_is_ignored",
            fields={b"other": b"ignored"},
            expected_messages=[],
        ),
    ]


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

    def test_topic_uses_prefixed_stream_key(self, fake_redis: FakeStreamsRedis):
        with patch("extensions.redis_names.dify_config") as mock_config:
            mock_config.REDIS_KEY_PREFIX = "enterprise-a"

            topic = StreamsBroadcastChannel(fake_redis, retention_seconds=60).topic("alpha")

        assert topic._topic == "alpha"
        assert topic._key == "enterprise-a:stream:alpha"

    def test_publish_uses_prefixed_stream_key(self, fake_redis: FakeStreamsRedis):
        with patch("extensions.redis_names.dify_config") as mock_config:
            mock_config.REDIS_KEY_PREFIX = "enterprise-a"
            topic = StreamsBroadcastChannel(fake_redis, retention_seconds=60).topic("beta")

            topic.publish(b"hello")

        assert fake_redis._store["enterprise-a:stream:beta"][0][1] == {b"data": b"hello"}
        assert fake_redis._expire_calls.get("enterprise-a:stream:beta", 0) >= 1

    def test_topic_exposes_self_as_producer_and_subscriber(self, streams_channel: StreamsBroadcastChannel):
        topic = streams_channel.topic("producer-subscriber")

        assert topic.as_producer() is topic
        assert topic.as_subscriber() is topic

    def test_topic_exposes_retained_cursor_window(self, streams_channel: StreamsBroadcastChannel):
        topic = streams_channel.topic("cursor-window")
        assert topic.earliest_cursor() is None
        assert topic.latest_cursor() is None

        topic.publish(b"first")
        topic.publish(b"second")

        assert topic.earliest_cursor() == "1-0"
        assert topic.latest_cursor() == "2-0"

    def test_publish_propagates_atomic_retention_failure(self):
        channel = StreamsBroadcastChannel(FailExpireRedis(), retention_seconds=60)
        topic = channel.topic("expire-warning")

        with pytest.raises(RuntimeError, match="expire failed"):
            topic.publish(b"payload")


class TestStreamsSubscription:
    def test_subscribe_replays_retained_messages_then_receives_live_messages(
        self,
        streams_channel: StreamsBroadcastChannel,
    ):
        topic = streams_channel.topic("gamma")
        topic.publish(b"before-subscribe")

        sub = topic.subscribe()
        assert isinstance(sub, _StreamsSubscription)

        received: list[bytes] = []
        with sub:
            replayed = sub.receive_with_cursor(timeout=0.05)
            assert replayed is not None
            assert replayed.payload == b"before-subscribe"
            assert replayed.cursor == "1-0"
            topic.publish(b"after-subscribe-1")
            topic.publish(b"after-subscribe-2")
            # Drain using receive() to avoid indefinite iteration in tests
            for _ in range(5):
                msg = sub.receive(timeout=0.1)
                if msg is None:
                    break
                received.append(msg)

        assert received == [b"after-subscribe-1", b"after-subscribe-2"]

    def test_subscribe_after_cursor_does_not_duplicate_acknowledged_event(
        self,
        streams_channel: StreamsBroadcastChannel,
    ) -> None:
        topic = streams_channel.topic("cursor-replay")
        topic.publish(b"one")
        topic.publish(b"two")
        topic.publish(b"three")

        with topic.subscribe(cursor="1-0") as sub:
            assert sub.receive(timeout=0.1) == b"two"
            cursor_message = sub.receive_with_cursor(timeout=0.1)
            assert cursor_message is not None
            assert cursor_message.payload == b"three"
            assert cursor_message.cursor == "3-0"
            assert sub.receive(timeout=0.05) is None

    def test_legacy_shared_close_marker_is_skipped_without_stalling_cursor(
        self,
        streams_channel: StreamsBroadcastChannel,
        fake_redis: FakeStreamsRedis,
    ) -> None:
        topic = streams_channel.topic("legacy-close-marker")
        fake_redis.xadd(topic._key, {b"data": SIG_CLOSE})
        topic.publish(b"application-event")

        with topic.subscribe() as sub:
            message = sub.receive_with_cursor(timeout=0.1)
            assert message is not None
            assert message.payload == b"application-event"
            assert message.cursor == "2-0"

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
            with pytest.raises(SubscriptionClosedError):
                sub.receive()

    def test_no_expire_when_zero_retention(self, fake_redis: FakeStreamsRedis):
        channel = StreamsBroadcastChannel(fake_redis, retention_seconds=0)
        topic = channel.topic("zeta")
        topic.publish(b"payload")
        # No expire recorded when retention is disabled
        assert fake_redis._expire_calls.get("stream:zeta") is None

    @pytest.mark.parametrize(
        ("case"),
        build_listen_payload_cases(),
        ids=lambda case: cast(ListenPayloadCase, case).name,
    )
    def test_listener_normalizes_supported_payloads_and_ignores_unsupported_shapes(self, case: ListenPayloadCase):
        class OneShotRedis:
            def __init__(self, fields: object) -> None:
                self._fields = fields
                self._calls = 0

            def xread(self, streams: dict[str, Any], block: int | None = None, count: int | None = None):
                self._calls += 1
                if self._calls == 1:
                    key = next(iter(streams))
                    return [(key, [("1-0", self._fields)])]
                subscription._closed = True
                return []

        subscription = _StreamsSubscription(OneShotRedis(case.fields), "stream:payload-shape")
        subscription._listen()

        received: list[bytes] = []
        while not subscription._queue.empty():
            item = subscription._queue.get_nowait()
            if item is subscription._SENTINEL:
                break
            received.append(item.payload)

        assert received == case.expected_messages

    def test_listener_ignores_close_signal_from_another_subscription(self):
        class OneShotRedis:
            def __init__(self) -> None:
                self._calls = 0

            def xread(self, streams: dict[str, Any], block: int | None = None, count: int | None = None):
                self._calls += 1
                if self._calls == 1:
                    key = next(iter(streams))
                    return [
                        (
                            key,
                            [
                                ("1-0", {b"data": SIG_CLOSE}),
                                ("2-0", {b"data": b"next-event"}),
                            ],
                        )
                    ]
                subscription._closed = True
                return []

        subscription = _StreamsSubscription(OneShotRedis(), "stream:close-signal")
        subscription._listen()

        assert subscription._queue.get_nowait() == CursorMessage(payload=b"next-event", cursor="2-0")
        assert subscription._queue.get_nowait() is subscription._SENTINEL
        assert subscription._queue.empty()

    def test_iterator_yields_messages_until_subscription_is_closed(self, streams_channel: StreamsBroadcastChannel):
        topic = streams_channel.topic("iter")
        subscription = topic.subscribe()
        iterator = iter(subscription)

        def publish_later() -> None:
            time.sleep(0.05)
            topic.publish(b"iter-message")

        publisher = threading.Thread(target=publish_later, daemon=True)
        publisher.start()

        assert next(iterator) == b"iter-message"

        subscription.close()
        publisher.join(timeout=1)
        with pytest.raises(StopIteration):
            next(iterator)

    def test_receive_with_none_timeout_blocks_until_message_arrives(self, streams_channel: StreamsBroadcastChannel):
        topic = streams_channel.topic("blocking")
        subscription = topic.subscribe()

        def publish_later() -> None:
            time.sleep(0.05)
            topic.publish(b"blocking-message")

        publisher = threading.Thread(target=publish_later, daemon=True)
        publisher.start()

        try:
            assert subscription.receive(timeout=None) == b"blocking-message"
        finally:
            subscription.close()
            publisher.join(timeout=1)

    def test_receive_raises_when_queue_contains_close_sentinel(self):
        subscription = _StreamsSubscription(FakeStreamsRedis(), "stream:sentinel")
        subscription._listener = threading.current_thread()
        subscription._queue.put_nowait(subscription._SENTINEL)

        with pytest.raises(SubscriptionClosedError):
            subscription.receive(timeout=0.01)

    def test_close_before_listener_starts_is_a_noop(self):
        subscription = _StreamsSubscription(FakeStreamsRedis(), "stream:not-started")

        subscription.close()

        assert subscription._listener is None
        with pytest.raises(SubscriptionClosedError):
            subscription.receive(timeout=0.01)

    def test_start_if_needed_returns_immediately_for_closed_subscription(self):
        subscription = _StreamsSubscription(FakeStreamsRedis(), "stream:already-closed")
        subscription._closed = True

        subscription._start_if_needed()

        assert subscription._listener is None

    def test_iterator_skips_none_results_and_keeps_polling(self):
        subscription = _StreamsSubscription(FakeStreamsRedis(), "stream:iterator-none")
        items = iter([None, b"event"])

        subscription._start_if_needed = lambda: None  # type: ignore[method-assign]

        def fake_receive(timeout: float | None = 0.1) -> bytes | None:
            value = next(items)
            if value is not None:
                subscription._closed = True
            return value

        subscription.receive = fake_receive  # type: ignore[method-assign]

        assert next(iter(subscription)) == b"event"

    def test_local_close_stops_listener_without_publishing_control_event(self):
        blocking_redis = BlockingRedis()
        subscription = _StreamsSubscription(blocking_redis, "stream:prompt-close")

        # Drive listener startup so the thread is blocked in xread.
        subscription._start_if_needed()
        listener = subscription._listener
        assert listener is not None
        assert listener.is_alive()

        started = time.monotonic()
        subscription.close()
        elapsed = time.monotonic() - started

        assert elapsed < 0.5, f"close() took {elapsed:.3f}s; expected bounded local close"
        assert blocking_redis._store == {}

    def test_control_event_not_sent_when_listener_not_started(self):
        """close() should not fail when the listener was never started."""
        subscription = _StreamsSubscription(FakeStreamsRedis(), "stream:no-listener")
        subscription.close()

        assert subscription._listener is None
        with pytest.raises(SubscriptionClosedError):
            subscription.receive(timeout=0.01)
