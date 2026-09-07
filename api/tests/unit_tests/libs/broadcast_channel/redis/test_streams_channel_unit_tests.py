import abc
import threading
import time
from dataclasses import dataclass
from typing import Any, cast

import pytest

from libs.broadcast_channel import channel as broadcast_channel
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
        self._xread_calls = 0
        self._xrevrange_calls = 0

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

    def xrevrange(self, key: str, count: int | None = None):
        self._xrevrange_calls += 1
        entries = list(reversed(self._store.get(key, [])))
        if count is not None:
            entries = entries[:count]
        return entries

    # Consumer API
    def xread(self, streams: dict[str, Any], block: int | None = None, count: int | None = None):
        self._xread_calls += 1
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


class FailExpireRedis(FakeStreamsRedis):
    def expire(self, key: str, seconds: int) -> None:
        raise RuntimeError("expire failed")


class FailXrevrangeRedis(FakeStreamsRedis):
    def xrevrange(self, key: str, count: int | None = None):
        raise RuntimeError("xrevrange failed")


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

    def xrevrange(self, key: str, count: int | None = None):
        entries = list(reversed(self._store.get(key, [])))
        if count is not None:
            entries = entries[:count]
        return entries

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


def test_prepared_subscription_capability_is_an_abstract_base_class():
    capability = broadcast_channel.SupportsPreparedSubscription

    assert issubclass(capability, abc.ABC)
    assert broadcast_channel.Subscriber in capability.__mro__
    assert capability.__abstractmethods__ == {"prepare_subscription", "subscribe"}


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

    def test_topic_uses_prefixed_stream_key(self, fake_redis: FakeStreamsRedis, config_overrides):
        config_overrides(REDIS_KEY_PREFIX="enterprise-a")
        topic = StreamsBroadcastChannel(fake_redis, retention_seconds=60).topic("alpha")

        assert topic._topic == "alpha"
        assert topic._key == "enterprise-a:stream:alpha"

    def test_publish_uses_prefixed_stream_key(self, fake_redis: FakeStreamsRedis, config_overrides):
        config_overrides(REDIS_KEY_PREFIX="enterprise-a")
        topic = StreamsBroadcastChannel(fake_redis, retention_seconds=60).topic("beta")
        topic.publish(b"hello")

        assert fake_redis._store["enterprise-a:stream:beta"][0][1] == {b"data": b"hello"}
        assert fake_redis._expire_calls.get("enterprise-a:stream:beta", 0) >= 1

    def test_topic_exposes_producer_and_subscriber_views(self, streams_channel: StreamsBroadcastChannel):
        topic = streams_channel.topic("producer-subscriber")
        subscriber = topic.as_subscriber()

        assert topic.as_producer() is topic
        assert subscriber is not topic
        assert not isinstance(topic, broadcast_channel.SupportsPreparedSubscription)
        assert isinstance(subscriber, broadcast_channel.SupportsPreparedSubscription)

    def test_topic_explicitly_supports_prepared_subscriptions(self, streams_channel: StreamsBroadcastChannel):
        topic = streams_channel.topic("prepared-capability")

        assert isinstance(topic.as_subscriber(), broadcast_channel.SupportsPreparedSubscription)

    def test_publish_logs_warning_when_expire_fails(self, caplog: pytest.LogCaptureFixture):
        channel = StreamsBroadcastChannel(FailExpireRedis(), retention_seconds=60)
        topic = channel.topic("expire-warning")

        topic.publish(b"payload")

        assert "Failed to set expire for stream key" in caplog.text


class TestStreamsSubscription:
    def test_subscribe_only_receives_messages_published_after_subscription_starts(
        self,
        streams_channel: StreamsBroadcastChannel,
    ):
        topic = streams_channel.topic("gamma")
        topic.publish(b"before-subscribe")

        sub = topic.subscribe()
        assert isinstance(sub, _StreamsSubscription)

        received: list[bytes] = []
        with sub:
            assert sub.receive(timeout=0.05) is None
            topic.publish(b"after-subscribe-1")
            topic.publish(b"after-subscribe-2")
            # Drain using receive() to avoid indefinite iteration in tests
            for _ in range(5):
                msg = sub.receive(timeout=0.1)
                if msg is None:
                    break
                received.append(msg)

        assert received == [b"after-subscribe-1", b"after-subscribe-2"]

    def test_subscribe_starts_xread_at_latest_id_without_resolving_boundary(self):
        start_ids: list[Any] = []

        class OneReadRedis:
            def xread(self, streams: dict[str, Any], block: int | None = None, count: int | None = None):
                start_ids.extend(streams.values())
                subscription._closed = True
                return []

        subscription = _StreamsSubscription(OneReadRedis(), "stream:latest-boundary")
        subscription._listen()

        assert start_ids == ["$"]

    def test_prepare_subscription_fixes_boundary_without_starting_listener(
        self,
        streams_channel: StreamsBroadcastChannel,
        fake_redis: FakeStreamsRedis,
    ):
        topic = streams_channel.topic("prepared-boundary")
        topic.publish(b"before-prepare")
        subscriber = topic.as_subscriber()
        assert isinstance(subscriber, broadcast_channel.SupportsPreparedSubscription)

        sub = subscriber.prepare_subscription()

        assert isinstance(sub, _StreamsSubscription)
        assert sub._start_id == "1-0"
        assert sub._listener is None
        assert fake_redis._xrevrange_calls == 1
        assert fake_redis._xread_calls == 0

    def test_prepared_subscription_includes_messages_published_before_entry_in_order(
        self,
        streams_channel: StreamsBroadcastChannel,
        fake_redis: FakeStreamsRedis,
    ):
        topic = streams_channel.topic("prepared-ordering")
        topic.publish(b"before-prepare")
        subscriber = topic.as_subscriber()
        assert isinstance(subscriber, broadcast_channel.SupportsPreparedSubscription)
        sub = subscriber.prepare_subscription()

        topic.publish(b"after-prepare-1")
        topic.publish(b"after-prepare-2")

        received: list[bytes] = []
        with sub:
            for _ in range(2):
                message = sub.receive(timeout=0.1)
                assert message is not None
                received.append(message)

        assert received == [b"after-prepare-1", b"after-prepare-2"]
        assert fake_redis._xrevrange_calls == 1

    def test_prepare_subscription_uses_beginning_boundary_for_empty_stream(
        self,
        streams_channel: StreamsBroadcastChannel,
        fake_redis: FakeStreamsRedis,
    ):
        topic = streams_channel.topic("prepared-empty")
        subscriber = topic.as_subscriber()
        assert isinstance(subscriber, broadcast_channel.SupportsPreparedSubscription)

        sub = subscriber.prepare_subscription()
        assert isinstance(sub, _StreamsSubscription)
        assert sub._start_id == "0-0"

        topic.publish(b"first-event")
        with sub:
            assert sub.receive(timeout=0.1) == b"first-event"

        assert fake_redis._xrevrange_calls == 1

    def test_prepare_subscription_propagates_boundary_resolution_error(self):
        channel = StreamsBroadcastChannel(FailXrevrangeRedis(), retention_seconds=60)
        topic = channel.topic("broken-checkpoint")
        subscriber = topic.as_subscriber()
        assert isinstance(subscriber, broadcast_channel.SupportsPreparedSubscription)

        with pytest.raises(RuntimeError, match="xrevrange failed"):
            subscriber.prepare_subscription()

    def test_prepared_subscription_receives_messages_published_right_after_entering(
        self,
        streams_channel: StreamsBroadcastChannel,
    ):
        """Regression test for the `workflow_started`-drop race (dify#40948).

        A prepared subscription fixes the delivery boundary before the background task can
        publish, so listener-thread scheduling cannot cause the first event to be missed.
        """
        topic = streams_channel.topic("race-topic")
        subscriber = topic.as_subscriber()
        assert isinstance(subscriber, broadcast_channel.SupportsPreparedSubscription)

        sub = subscriber.prepare_subscription()
        received: list[bytes] = []
        with sub:
            topic.publish(b"workflow_started")
            for _ in range(5):
                msg = sub.receive(timeout=0.1)
                if msg is None:
                    break
                received.append(msg)

        assert received == [b"workflow_started"]

    def test_subscribe_does_not_replay_messages_published_before_it_started(
        self,
        streams_channel: StreamsBroadcastChannel,
    ):
        """`subscribe` preserves the "no stale replay" fix from #34030/#34040."""
        topic = streams_channel.topic("no-replay-topic")
        topic.publish(b"stale-event")

        sub = topic.subscribe()
        received: list[bytes] = []
        with sub:
            assert sub.receive(timeout=0.05) is None
            topic.publish(b"fresh-event")
            for _ in range(5):
                msg = sub.receive(timeout=0.1)
                if msg is None:
                    break
                received.append(msg)

        assert received == [b"fresh-event"]

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
        subscription._start_id = "0-0"
        subscription._listen()

        received: list[bytes] = []
        while not subscription._queue.empty():
            item = subscription._queue.get_nowait()
            if item is subscription._SENTINEL:
                break
            received.append(bytes(item))

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
        subscription._start_id = "0-0"
        subscription._listen()

        assert subscription._queue.get_nowait() == b"next-event"
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

    def test_control_event_unblocks_listener_for_prompt_close(self):
        """close() returns promptly because the control event (xadd) unblocks
        the listener from its blocking xread call.
        """
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

        # The control event (xadd) wakes up xread immediately, so close()
        # should return well under 1s (the xread BLOCK timeout).
        assert elapsed < 0.5, f"close() took {elapsed:.3f}s; expected prompt return via control event"

    def test_control_event_not_sent_when_listener_not_started(self):
        """close() should not fail when the listener was never started."""
        subscription = _StreamsSubscription(FakeStreamsRedis(), "stream:no-listener")
        subscription.close()

        assert subscription._listener is None
        with pytest.raises(SubscriptionClosedError):
            subscription.receive(timeout=0.01)
