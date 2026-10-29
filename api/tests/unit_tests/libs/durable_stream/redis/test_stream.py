from collections.abc import Callable
from typing import cast

import pytest
from pytest_mock import MockerFixture
from redis import Redis
from redis.exceptions import ConnectionError

from libs.durable_stream import CLOSED, CursorUnavailableError, DurableStreamRecord, DurableStreamUnavailableError
from libs.durable_stream.redis import RedisDurableStreamTopic
from tests.unit_tests.libs.durable_stream.redis.fake_redis import FakeRedisDurableStream


def test_topic_uses_configured_redis_key_prefix(config_overrides: Callable[..., None]) -> None:
    config_overrides(REDIS_KEY_PREFIX="tenant-a")
    redis = FakeRedisDurableStream()

    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "workflow-1")

    assert topic._key == "tenant-a:durable_stream:workflow-1"


def test_append_and_seal_refresh_retention_and_keep_one_seal_marker() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "retention", retention_seconds=42)

    topic.append(b"record")
    topic.seal()
    topic.seal()

    assert redis.expirations[topic._key] == 42
    assert [fields[b"kind"] for _, fields in redis.entries(topic._key)] == [b"data", b"seal"]


def test_subscription_creation_maps_redis_failure() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "unavailable")
    redis.fail_next_eval = True

    with pytest.raises(DurableStreamUnavailableError):
        topic.subscribe_from_tail()


def test_empty_subscription_detects_boundary_trim_before_entry() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "trimmed", max_length=2)
    subscription = topic.subscribe_from_tail()

    topic.append(b"first")
    topic.append(b"second")

    with pytest.raises(CursorUnavailableError):
        subscription.__enter__()


def test_empty_beginning_subscription_delivers_record_appended_before_entry() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "empty-beginning")
    subscription = topic.subscribe_from_beginning()
    topic.append(b"first")

    with subscription:
        record = subscription.receive(timeout=0)
        assert isinstance(record, DurableStreamRecord)
        assert record.payload == b"first"


@pytest.mark.parametrize("mode", ["beginning", "tail"])
def test_subscription_to_empty_sealed_topic_is_closed(mode: str) -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "sealed")
    topic.seal()
    subscription = getattr(topic, f"subscribe_from_{mode}")()

    with subscription:
        assert subscription.receive(timeout=0) is CLOSED
        assert subscription.receive(timeout=0) is CLOSED


def test_tail_subscription_to_sealed_topic_does_not_replay_records() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "sealed-tail")
    topic.append(b"historical")
    topic.seal()

    with topic.subscribe_from_tail() as subscription:
        assert subscription.receive(timeout=0) is CLOSED


def test_seal_maps_redis_failure_and_can_be_retried() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "seal-failure")
    redis.fail_next_eval = True

    with pytest.raises(DurableStreamUnavailableError) as error:
        topic.seal()
    assert isinstance(error.value.__cause__, ConnectionError)

    topic.seal()
    with topic.subscribe_from_tail() as subscription:
        assert subscription.receive(timeout=0) is CLOSED


@pytest.mark.parametrize("entry_id", ["invalid", "1", "-1-0", "1-a"])
def test_cursor_with_invalid_stream_id_is_rejected(entry_id: str) -> None:
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", FakeRedisDurableStream()), "invalid-id")

    with pytest.raises(CursorUnavailableError, match="invalid Redis Stream ID"):
        topic.subscribe_from_cursor(topic._encode_cursor(entry_id))


@pytest.mark.parametrize("sealed", [False, True])
def test_cursor_cannot_identify_control_record(sealed: bool) -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "control-cursor")
    if sealed:
        topic.seal()
    else:
        topic.subscribe_from_tail()
    entry_id = redis.entries(topic._key)[0][0].decode()

    with pytest.raises(CursorUnavailableError, match="does not identify"):
        topic.subscribe_from_cursor(topic._encode_cursor(entry_id))


@pytest.mark.parametrize(
    "response",
    [None, [], [b"1-0"], [b"1-0", b"data", b"extra"], [b"invalid", b"data"], [b"1-0", b"unknown"]],
)
def test_invalid_boundary_response_is_mapped(mocker: MockerFixture, response: object) -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "invalid-boundary")
    mocker.patch.object(redis, "execute_command", return_value=response)

    with pytest.raises(DurableStreamUnavailableError, match="invalid durable stream boundary"):
        topic.subscribe_from_tail()


def test_sealed_beginning_subscription_enter_failure_is_terminal() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "sealed-enter-failure")
    topic.seal()
    subscription = topic.subscribe_from_beginning()
    redis.fail_next_xrevrange = True

    with pytest.raises(DurableStreamUnavailableError) as error:
        subscription.__enter__()
    assert isinstance(error.value.__cause__, ConnectionError)
    assert subscription.receive(timeout=0) is CLOSED


def test_receive_before_enter_is_rejected_without_consuming_records() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "before-enter")
    topic.append(b"record")
    subscription = topic.subscribe_from_beginning()

    with pytest.raises(DurableStreamUnavailableError, match="has not been entered"):
        subscription.receive(timeout=0)

    with subscription:
        record = subscription.receive(timeout=0)
        assert isinstance(record, DurableStreamRecord)
        assert record.payload == b"record"


@pytest.mark.parametrize("entry", [None, [b"1-0"], [b"1-0", []]])
def test_invalid_read_entry_is_terminal(mocker: MockerFixture, entry: object) -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "invalid-entry")

    with topic.subscribe_from_tail() as subscription:
        mocker.patch.object(redis, "xread", return_value=[(topic._key, [entry])])
        with pytest.raises(DurableStreamUnavailableError, match="invalid durable stream entry"):
            subscription.receive(timeout=0)
        assert subscription.receive(timeout=0) is CLOSED


@pytest.mark.parametrize(
    ("entry_id", "fields"),
    [
        (b"invalid", {b"kind": b"data", b"data": b"payload"}),
        (b"\xff", {b"kind": b"data", b"data": b"payload"}),
        (None, {b"kind": b"data", b"data": b"payload"}),
        (b"1-0", {b"kind": b"unknown"}),
        (b"1-0", {}),
        (b"1-0", {b"kind": b"data"}),
        (b"1-0", {b"kind": b"data", b"data": 42}),
    ],
)
def test_corrupt_boundary_entry_causes_terminal_enter_failure(
    mocker: MockerFixture, entry_id: object, fields: dict[bytes, object]
) -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "corrupt-boundary")
    subscription = topic.subscribe_from_tail()
    mocker.patch.object(redis, "xrange", return_value=[(entry_id, fields)])

    with pytest.raises(DurableStreamUnavailableError):
        subscription.__enter__()
    assert subscription.receive(timeout=0) is CLOSED


@pytest.mark.parametrize("payload", ["payload", bytearray(b"\x00\xff")])
def test_supported_redis_response_values_preserve_payload(mocker: MockerFixture, payload: str | bytearray) -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "response-values")

    with topic.subscribe_from_tail() as subscription:
        mocker.patch.object(redis, "xread", return_value=[(topic._key, [("2-0", {"kind": "data", "data": payload})])])
        record = subscription.receive(timeout=0)
        assert isinstance(record, DurableStreamRecord)
        assert record.payload == (payload.encode() if isinstance(payload, str) else bytes(payload))


def test_boundary_control_record_is_skipped_during_delivery() -> None:
    redis = FakeRedisDurableStream()
    topic = RedisDurableStreamTopic(cast("Redis[bytes]", redis), "skip-boundary")
    subscription = topic.subscribe_from_tail()
    with redis._condition:
        redis._add(topic._key, {b"kind": b"boundary"}, max_length=5000, retention=600)
    topic.append(b"record")

    with subscription:
        record = subscription.receive(timeout=0.1)
        assert isinstance(record, DurableStreamRecord)
        assert record.payload == b"record"
        assert subscription.receive(timeout=0) is None
