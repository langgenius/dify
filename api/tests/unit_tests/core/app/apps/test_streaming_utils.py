from __future__ import annotations

import json
import queue

import pytest

from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.entities.task_entities import StreamEvent
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

    def subscribe(self) -> FakeSubscription:
        return FakeSubscription(self._queue, self._state)

    def publish(self, payload: bytes) -> None:
        self._queue.put(payload)

    @property
    def subscribed(self) -> bool:
        return self._state["subscribed"]


def test_retrieve_events_calls_on_subscribe_after_subscription(monkeypatch):
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

    assert next(generator) == StreamEvent.PING.value
    event = next(generator)
    assert event["event"] == StreamEvent.WORKFLOW_FINISHED.value
    with pytest.raises(StopIteration):
        next(generator)
