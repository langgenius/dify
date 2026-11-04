from __future__ import annotations

import json
import queue

import pytest

from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.streaming_utils import _normalize_terminal_events, stream_topic_events
from core.app.entities.task_entities import StreamEvent
from libs.broadcast_channel.channel import SupportsPreparedSubscription
from models.model import AppMode


class FakeSubscription:
    def __init__(self, message_queue: queue.Queue[bytes], state: dict[str, bool]) -> None:
        self._queue = message_queue
        self._state = state
        self._closed = False

    def __enter__(self):
        self._state["subscribed"] = True
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def close(self) -> None:
        self._closed = True

    def receive(self, timeout: float | None = 0.1) -> bytes | None:
        if self._closed:
            return None
        try:
            if timeout is None:
                return self._queue.get()
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return None


class FakeTopic:
    def __init__(self) -> None:
        self._queue: queue.Queue[bytes] = queue.Queue()
        self._state = {"subscribed": False}
        self.subscribe_calls = 0
        self.subscriber_view_calls = 0

    def as_subscriber(self):
        self.subscriber_view_calls += 1
        return self

    def subscribe(self) -> FakeSubscription:
        self.subscribe_calls += 1
        return FakeSubscription(self._queue, self._state)

    def publish(self, payload: bytes) -> None:
        self._queue.put(payload)

    @property
    def subscribed(self) -> bool:
        return self._state["subscribed"]


class FakePreparedSubscriber(SupportsPreparedSubscription):
    def __init__(self, message_queue: queue.Queue[bytes], state: dict[str, bool]) -> None:
        self._queue = message_queue
        self._state = state
        self.prepare_calls = 0

    def prepare_subscription(self) -> FakeSubscription:
        self.prepare_calls += 1
        return FakeSubscription(self._queue, self._state)

    def subscribe(self) -> FakeSubscription:
        return FakeSubscription(self._queue, self._state)


class FailingPreparedSubscriber(FakePreparedSubscriber):
    def prepare_subscription(self) -> FakeSubscription:
        raise RuntimeError("prepare failed")


class FakePreparedTopic(FakeTopic):
    def __init__(self) -> None:
        super().__init__()
        self.subscriber = FakePreparedSubscriber(self._queue, self._state)

    def as_subscriber(self) -> FakePreparedSubscriber:
        self.subscriber_view_calls += 1
        return self.subscriber


class FailingPreparedTopic(FakeTopic):
    def __init__(self) -> None:
        super().__init__()
        self.subscriber = FailingPreparedSubscriber(self._queue, self._state)

    def as_subscriber(self) -> FailingPreparedSubscriber:
        self.subscriber_view_calls += 1
        return self.subscriber


def test_retrieve_events_falls_back_to_subscribe_and_invokes_hook_after_entry(monkeypatch: pytest.MonkeyPatch):
    topic = FakeTopic()

    def fake_get_response_topic(cls, app_mode, workflow_run_id):
        return topic

    monkeypatch.setattr(MessageBasedAppGenerator, "get_response_topic", classmethod(fake_get_response_topic))

    def on_subscribe() -> None:
        assert topic.subscribed is True
        event = {"event": StreamEvent.WORKFLOW_FINISHED.value}
        topic.publish(json.dumps(event).encode())

    generator = MessageBasedAppGenerator.retrieve_events(
        AppMode.WORKFLOW,
        "workflow-run-id",
        idle_timeout=0.5,
        on_subscribe=on_subscribe,
    )

    assert topic.subscriber_view_calls == 1
    assert topic.subscribe_calls == 1
    assert topic.subscribed is False
    assert next(generator) == StreamEvent.PING.value
    event = next(generator)
    assert event["event"] == StreamEvent.WORKFLOW_FINISHED.value
    with pytest.raises(StopIteration):
        next(generator)


def test_retrieve_events_prepares_capable_topic_before_generator_iteration(monkeypatch: pytest.MonkeyPatch):
    topic = FakePreparedTopic()

    def fake_get_response_topic(cls, app_mode, workflow_run_id):
        return topic

    monkeypatch.setattr(MessageBasedAppGenerator, "get_response_topic", classmethod(fake_get_response_topic))

    generator = MessageBasedAppGenerator.retrieve_events(
        AppMode.WORKFLOW,
        "workflow-run-id",
        idle_timeout=0.5,
    )

    assert topic.subscriber_view_calls == 1
    assert topic.subscriber.prepare_calls == 1
    assert topic.subscribe_calls == 0
    assert topic.subscribed is False

    topic.publish(json.dumps({"event": StreamEvent.WORKFLOW_FINISHED.value}).encode())
    assert next(generator) == StreamEvent.PING.value
    assert next(generator)["event"] == StreamEvent.WORKFLOW_FINISHED.value


def test_retrieve_events_propagates_preparation_error_before_generator_iteration(monkeypatch: pytest.MonkeyPatch):
    topic = FailingPreparedTopic()

    def fake_get_response_topic(cls, app_mode, workflow_run_id):
        return topic

    monkeypatch.setattr(MessageBasedAppGenerator, "get_response_topic", classmethod(fake_get_response_topic))

    with pytest.raises(RuntimeError, match="prepare failed"):
        MessageBasedAppGenerator.retrieve_events(
            AppMode.WORKFLOW,
            "workflow-run-id",
            idle_timeout=0.5,
        )


def test_normalize_terminal_events_defaults():
    assert _normalize_terminal_events(None) == {
        StreamEvent.WORKFLOW_FINISHED.value,
        StreamEvent.WORKFLOW_PAUSED.value,
    }


def test_normalize_terminal_events_empty_values():
    assert _normalize_terminal_events([]) == set({})


def test_stream_topic_events_emits_ping_and_idle_timeout(monkeypatch: pytest.MonkeyPatch):
    topic = FakeTopic()
    subscription = topic.subscribe()
    times = [1000.0, 1000.0, 1001.0, 1001.0, 1002.0]

    def fake_time():
        return times.pop(0)

    monkeypatch.setattr("core.app.apps.streaming_utils.time.time", fake_time)

    generator = stream_topic_events(
        subscription=subscription,
        idle_timeout=10.0,
        ping_interval=1.0,
    )

    assert next(generator) == StreamEvent.PING.value
    # next receive yields None -> ping interval triggers
    assert next(generator) == StreamEvent.PING.value


def test_stream_topic_events_can_continue_past_pause():
    topic = FakeTopic()
    topic.publish(json.dumps({"event": StreamEvent.WORKFLOW_PAUSED.value}).encode())
    topic.publish(json.dumps({"event": StreamEvent.WORKFLOW_FINISHED.value}).encode())
    subscription = topic.subscribe()

    generator = stream_topic_events(
        subscription=subscription,
        idle_timeout=1.0,
        terminal_events=[StreamEvent.WORKFLOW_FINISHED.value],
    )

    assert next(generator) == StreamEvent.PING.value
    assert next(generator)["event"] == StreamEvent.WORKFLOW_PAUSED.value
    assert next(generator)["event"] == StreamEvent.WORKFLOW_FINISHED.value
    with pytest.raises(StopIteration):
        next(generator)
