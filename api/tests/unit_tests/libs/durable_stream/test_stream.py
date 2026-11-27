import dataclasses
from typing import Self, override

from libs.durable_stream import (
    CLOSED,
    Closed,
    DurableStreamProducer,
    DurableStreamRecord,
    DurableStreamSubscription,
    DurableStreamTopic,
    TopicCursor,
)


class _Subscription(DurableStreamSubscription):
    def __init__(self) -> None:
        self.closed = False

    @override
    def __enter__(self) -> Self:
        return self

    @override
    def close(self) -> None:
        self.closed = True

    @override
    def receive(self, timeout: float = 0.1) -> DurableStreamRecord | Closed | None:
        del timeout
        return CLOSED


def test_record_is_frozen_and_slotted() -> None:
    record = DurableStreamRecord(payload=b"payload", cursor=TopicCursor("cursor"))

    assert record.payload == b"payload"
    assert record.cursor == "cursor"
    assert not hasattr(record, "__dict__")

    try:
        record.payload = b"changed"  # type: ignore[misc]
    except dataclasses.FrozenInstanceError:
        pass
    else:
        raise AssertionError("DurableStreamRecord must be immutable")


def test_closed_is_a_distinct_terminal_receive_result() -> None:
    assert CLOSED is Closed.CLOSED
    assert list(Closed) == [CLOSED]


def test_subscription_context_exit_closes_subscription() -> None:
    subscription = _Subscription()

    with subscription as entered:
        assert entered is subscription
        assert not subscription.closed

    assert subscription.closed


def test_protocols_expose_the_proposed_operations() -> None:
    assert vars(DurableStreamSubscription)["__abstractmethods__"] == {"__enter__", "close", "receive"}
    assert vars(DurableStreamProducer)["__abstractmethods__"] == {"append"}
    assert vars(DurableStreamTopic)["__abstractmethods__"] == {
        "append",
        "as_producer",
        "seal",
        "subscribe_from_beginning",
        "subscribe_from_cursor",
        "subscribe_from_tail",
    }
