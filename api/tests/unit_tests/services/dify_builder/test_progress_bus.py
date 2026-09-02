"""Tests for the session progress bus."""

import json
import threading
from collections.abc import Iterator
from typing import Self
from unittest.mock import MagicMock, patch

import pytest

from libs.broadcast_channel.channel import Subscription, SupportsPreparedSubscription
from services.dify_builder import progress_bus, wiring

SESSION_ID = "11111111-1111-1111-1111-111111111111"


def test_publish_sends_json_encoded_event_to_the_session_topic() -> None:
    fake_channel = MagicMock()
    event = {"kind": "node", "node_id": "abc", "status": "succeeded"}

    with patch("services.dify_builder.progress_bus.get_pubsub_broadcast_channel", return_value=fake_channel):
        progress_bus.publish(SESSION_ID, event)

    fake_channel.topic.assert_called_once_with(f"dify_builder:{SESSION_ID}")
    fake_topic = fake_channel.topic.return_value
    fake_topic.publish.assert_called_once()
    (payload,) = fake_topic.publish.call_args.args
    assert isinstance(payload, bytes)
    assert json.loads(payload.decode()) == event


class _Subscription(Subscription):
    def __init__(self, order: list[str], *, fail_on_enter: bool = False) -> None:
        self.order = order
        self.fail_on_enter = fail_on_enter
        self.close_count = 0

    def __iter__(self) -> Iterator[bytes]:
        return iter(())

    def __enter__(self) -> Self:
        self.order.append("activate")
        if self.fail_on_enter:
            raise RuntimeError("activation failed")
        return self

    def receive(self, timeout: float | None = 0.1) -> bytes | None:  # noqa: ARG002
        return None

    def close(self) -> None:
        self.close_count += 1


class _PreparedSubscriber(SupportsPreparedSubscription):
    def __init__(self, subscription: Subscription, order: list[str]) -> None:
        self.subscription = subscription
        self.order = order

    def subscribe(self) -> Subscription:
        self.order.append("lazy-subscribe")
        return self.subscription

    def prepare_subscription(self) -> Subscription:
        self.order.append("prepare")
        return self.subscription


class _LazySubscriber:
    def __init__(self, subscription: Subscription, order: list[str]) -> None:
        self.subscription = subscription
        self.order = order

    def subscribe(self) -> Subscription:
        self.order.append("construct")
        return self.subscription


class _TerminalSubscription(_Subscription):
    def receive(self, timeout: float | None = 0.1) -> bytes | None:  # noqa: ARG002
        return b'{"kind":"state","state":"success"}'


class _AckControlledSubscription(_Subscription):
    def __init__(self, order: list[str]) -> None:
        super().__init__(order)
        self.waiting_for_ack = threading.Event()
        self.release_ack = threading.Event()

    def __enter__(self) -> Self:
        self.order.append("activate")
        self.waiting_for_ack.set()
        if not self.release_ack.wait(timeout=1):
            raise TimeoutError("test subscription acknowledgement timed out")
        self.order.append("ack")
        return self


def test_subscribe_prepares_stream_delivery_boundary_without_activating() -> None:
    order: list[str] = []
    subscription = _Subscription(order)
    subscriber = _PreparedSubscriber(subscription, order)
    fake_channel = MagicMock()
    fake_channel.topic.return_value.as_subscriber.return_value = subscriber

    with patch("services.dify_builder.progress_bus.get_pubsub_broadcast_channel", return_value=fake_channel):
        result = progress_bus.subscribe(SESSION_ID)

    fake_channel.topic.assert_called_once_with(f"dify_builder:{SESSION_ID}")
    assert result is subscription
    assert order == ["prepare"]


def test_subscribe_activates_pubsub_before_returning_to_dispatch_caller() -> None:
    order: list[str] = []
    subscription = _Subscription(order)
    subscriber = _LazySubscriber(subscription, order)
    fake_channel = MagicMock()
    fake_channel.topic.return_value.as_subscriber.return_value = subscriber

    with patch("services.dify_builder.progress_bus.get_pubsub_broadcast_channel", return_value=fake_channel):
        result = progress_bus.subscribe(SESSION_ID)
        order.append("dispatch")

    assert result is subscription
    assert order == ["construct", "activate", "dispatch"]
    assert subscription.close_count == 0


def test_publish_after_subscribe_cannot_overtake_pubsub_activation_barrier() -> None:
    order: list[str] = []
    subscription = _AckControlledSubscription(order)
    subscriber = _LazySubscriber(subscription, order)
    fake_channel = MagicMock()
    fake_topic = fake_channel.topic.return_value
    fake_topic.as_subscriber.return_value = subscriber
    finished = threading.Event()
    errors: list[BaseException] = []

    def subscribe_then_publish() -> None:
        try:
            progress_bus.subscribe(SESSION_ID)
            order.append("publish")
            progress_bus.publish(SESSION_ID, {"kind": "state", "state": "success"})
            finished.set()
        except BaseException as error:
            errors.append(error)

    with patch("services.dify_builder.progress_bus.get_pubsub_broadcast_channel", return_value=fake_channel):
        caller = threading.Thread(target=subscribe_then_publish)
        caller.start()
        try:
            assert subscription.waiting_for_ack.wait(timeout=1)
            assert not finished.is_set()
            fake_topic.publish.assert_not_called()

            subscription.release_ack.set()
            caller.join(timeout=1)
        finally:
            subscription.release_ack.set()
            caller.join(timeout=1)

    assert not caller.is_alive()
    assert errors == []
    assert finished.is_set()
    assert order == ["construct", "activate", "ack", "publish"]
    fake_topic.publish.assert_called_once()


def test_subscribe_closes_pubsub_when_activation_fails() -> None:
    order: list[str] = []
    subscription = _Subscription(order, fail_on_enter=True)
    subscriber = _LazySubscriber(subscription, order)
    fake_channel = MagicMock()
    fake_channel.topic.return_value.as_subscriber.return_value = subscriber

    with (
        patch("services.dify_builder.progress_bus.get_pubsub_broadcast_channel", return_value=fake_channel),
        pytest.raises(RuntimeError, match="activation failed"),
    ):
        progress_bus.subscribe(SESSION_ID)

    assert order == ["construct", "activate"]
    assert subscription.close_count == 1


def test_stream_generator_does_not_reenter_and_closes_prepared_subscription() -> None:
    order: list[str] = []
    subscription = _TerminalSubscription(order)
    subscriber = _LazySubscriber(subscription, order)
    fake_channel = MagicMock()
    fake_channel.topic.return_value.as_subscriber.return_value = subscriber

    with patch("services.dify_builder.progress_bus.get_pubsub_broadcast_channel", return_value=fake_channel):
        prepared = progress_bus.subscribe(SESSION_ID)

    frames = list(wiring.stream_advance_frames({"session_id": SESSION_ID}, prepared, expect_advance=True))

    assert order == ["construct", "activate"]
    assert frames[-1].startswith("event: message\n")
    assert json.loads(frames[-1].split("data: ", 1)[1])["event"] == "state"
    assert subscription.close_count == 1
