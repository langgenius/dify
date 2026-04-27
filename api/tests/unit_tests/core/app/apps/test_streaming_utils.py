from __future__ import annotations

import json
import logging
import queue
import time

import pytest

from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.streaming_utils import (
    _get_event_meta,
    _normalize_terminal_events,
    _process_event_meta,
    stream_topic_events,
)
from core.app.entities.task_entities import StreamEvent
from libs.broadcast_channel.meta import EVENT_META_KEY
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


def test_normalize_terminal_events_defaults():
    assert _normalize_terminal_events(None) == {
        StreamEvent.WORKFLOW_FINISHED.value,
        StreamEvent.WORKFLOW_PAUSED.value,
    }


def test_normalize_terminal_events_empty_values():
    assert _normalize_terminal_events([]) == set({})


def test_stream_topic_events_emits_ping_and_idle_timeout(monkeypatch):
    topic = FakeTopic()
    times = [1000.0, 1000.0, 1001.0, 1001.0, 1002.0]

    def fake_time():
        return times.pop(0)

    monkeypatch.setattr("core.app.apps.streaming_utils.time.time", fake_time)

    generator = stream_topic_events(
        topic=topic,
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

    generator = stream_topic_events(
        topic=topic,
        idle_timeout=1.0,
        terminal_events=[StreamEvent.WORKFLOW_FINISHED.value],
    )

    assert next(generator) == StreamEvent.PING.value
    assert next(generator)["event"] == StreamEvent.WORKFLOW_PAUSED.value
    assert next(generator)["event"] == StreamEvent.WORKFLOW_FINISHED.value
    with pytest.raises(StopIteration):
        next(generator)


class TestGetEventMeta:
    def test_returns_meta_from_dict(self):
        event = {EVENT_META_KEY: {"emit_ts": 1234.5}, "event": "text_chunk"}
        meta = _get_event_meta(event)
        assert meta is not None
        assert meta["emit_ts"] == 1234.5

    def test_strips_meta_key_from_event(self):
        event = {EVENT_META_KEY: {"emit_ts": 1234.5}, "event": "text_chunk"}
        _get_event_meta(event)
        assert EVENT_META_KEY not in event
        assert "event" in event

    def test_returns_none_when_no_meta_key(self):
        event = {"event": "text_chunk"}
        meta = _get_event_meta(event)
        assert meta is None

    def test_returns_none_for_non_dict(self):
        assert _get_event_meta("string event") is None
        assert _get_event_meta(None) is None
        assert _get_event_meta(42) is None


class TestProcessEventMeta:
    def test_logs_debug_for_normal_latency(self, monkeypatch, caplog):
        monkeypatch.setattr(time, "time", lambda: 1000.0)
        event = {EVENT_META_KEY: {"emit_ts": 999.5}, "event": "text_chunk"}
        with caplog.at_level(logging.DEBUG):
            _process_event_meta(event)
        assert "Event delivery latency: 0.50s" in caplog.text
        assert EVENT_META_KEY not in event

    def test_logs_debug_for_high_latency(self, monkeypatch, caplog):
        monkeypatch.setattr(time, "time", lambda: 1000.0)
        monkeypatch.setattr("core.app.apps.streaming_utils.dify_config.ENABLE_OTEL", False)
        event = {EVENT_META_KEY: {"emit_ts": 990.0}, "event": "text_chunk"}
        with caplog.at_level(logging.DEBUG):
            _process_event_meta(event)
        assert "Event delivery latency: 10.00s" in caplog.text
        assert EVENT_META_KEY not in event

    def test_no_log_when_meta_missing(self, monkeypatch, caplog):
        event = {"event": "text_chunk"}
        with caplog.at_level(logging.DEBUG):
            _process_event_meta(event)
        assert "Event delivery latency" not in caplog.text

    def test_no_log_when_emit_ts_missing(self, monkeypatch, caplog):
        event = {EVENT_META_KEY: {}, "event": "text_chunk"}
        with caplog.at_level(logging.DEBUG):
            _process_event_meta(event)
        assert "Event delivery latency" not in caplog.text

    def test_calls_record_delivery_latency_includes_app_id_when_configured(self, monkeypatch):
        called = []

        def fake_record(latency_seconds, *, event_type="", additional_attributes=None):
            called.append((latency_seconds, event_type, additional_attributes or {}))

        monkeypatch.setattr(time, "time", lambda: 1000.0)
        monkeypatch.setattr("core.app.apps.streaming_utils.dify_config.ENABLE_OTEL", True)
        monkeypatch.setattr("core.app.apps.streaming_utils.dify_config.PUBSUB_METRICS_RECORD_APP_ID", True)
        monkeypatch.setattr("core.app.apps.streaming_utils.record_delivery_latency", fake_record)

        event = {
            EVENT_META_KEY: {"emit_ts": 999.0, "tenant_id": "t1", "app_id": "a1"},
            "event": "text_chunk",
        }
        _process_event_meta(event)
        assert len(called) == 1
        assert called[0][0] == 1.0
        assert called[0][1] == "text_chunk"
        assert called[0][2] == {"tenant_id": "t1", "app_id": "a1"}

    def test_calls_record_delivery_latency_omits_app_id_when_pubsub_metrics_record_app_id_disabled(self, monkeypatch):
        called = []

        def fake_record(latency_seconds, *, event_type="", additional_attributes=None):
            called.append((latency_seconds, event_type, additional_attributes or {}))

        monkeypatch.setattr(time, "time", lambda: 1000.0)
        monkeypatch.setattr("core.app.apps.streaming_utils.dify_config.ENABLE_OTEL", True)
        monkeypatch.setattr("core.app.apps.streaming_utils.dify_config.PUBSUB_METRICS_RECORD_APP_ID", False)
        monkeypatch.setattr("core.app.apps.streaming_utils.record_delivery_latency", fake_record)

        event = {
            EVENT_META_KEY: {"emit_ts": 999.0, "tenant_id": "t1", "app_id": "a1"},
            "event": "text_chunk",
        }
        _process_event_meta(event)
        assert len(called) == 1
        assert called[0][2] == {"tenant_id": "t1", "app_id": ""}

    def test_calls_record_delivery_latency_omits_tenant_id_when_pubsub_metrics_record_tenant_id_disabled(
        self, monkeypatch
    ):
        called = []

        def fake_record(latency_seconds, *, event_type="", additional_attributes=None):
            called.append((latency_seconds, event_type, additional_attributes or {}))

        monkeypatch.setattr(time, "time", lambda: 1000.0)
        monkeypatch.setattr("core.app.apps.streaming_utils.dify_config.ENABLE_OTEL", True)
        monkeypatch.setattr("core.app.apps.streaming_utils.dify_config.PUBSUB_METRICS_RECORD_TENANT_ID", False)
        monkeypatch.setattr("core.app.apps.streaming_utils.dify_config.PUBSUB_METRICS_RECORD_APP_ID", True)
        monkeypatch.setattr("core.app.apps.streaming_utils.record_delivery_latency", fake_record)

        event = {
            EVENT_META_KEY: {"emit_ts": 999.0, "tenant_id": "t1", "app_id": "a1"},
            "event": "text_chunk",
        }
        _process_event_meta(event)
        assert len(called) == 1
        assert called[0][2] == {"tenant_id": "", "app_id": "a1"}

    def test_skips_record_when_otel_disabled(self, monkeypatch):
        called = []

        def fake_record(*args, **kwargs):
            called.append(1)

        monkeypatch.setattr(time, "time", lambda: 1000.0)
        monkeypatch.setattr("core.app.apps.streaming_utils.dify_config.ENABLE_OTEL", False)
        monkeypatch.setattr("core.app.apps.streaming_utils.record_delivery_latency", fake_record)

        event = {EVENT_META_KEY: {"emit_ts": 999.0}, "event": "text_chunk"}
        _process_event_meta(event)
        assert len(called) == 0
