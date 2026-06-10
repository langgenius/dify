import json
import uuid
from collections import defaultdict, deque
from typing import Any

import pytest

from core.app.apps.message_generator import MessageGenerator
from models.model import AppMode
from services.app_generate_service import AppGenerateService


# -----------------------------
# Fakes for Redis Pub/Sub flow
# -----------------------------
class _FakePubSub:
    def __init__(self, store: dict[str, deque[bytes]]):
        self._store = store
        self._subs: set[str] = set()
        self._closed = False

    def subscribe(self, topic: str) -> None:
        self._subs.add(topic)

    def unsubscribe(self, topic: str) -> None:
        self._subs.discard(topic)

    def close(self) -> None:
        self._closed = True

    def get_message(self, ignore_subscribe_messages: bool = True, timeout: int | float | None = 1):
        # simulate a non-blocking poll; return first available
        if self._closed:
            return None
        for t in list(self._subs):
            q = self._store.get(t)
            if q and len(q) > 0:
                payload = q.popleft()
                return {"type": "message", "channel": t, "data": payload}
        # no message
        return None


class _FakeRedisClient:
    def __init__(self, store: dict[str, deque[bytes]]):
        self._store = store

    def pubsub(self):
        return _FakePubSub(self._store)

    def publish(self, topic: str, payload: bytes) -> None:
        self._store.setdefault(topic, deque()).append(payload)


# ------------------------------------
# Fakes for Redis Streams (XADD/XREAD)
# ------------------------------------
class _FakeStreams:
    def __init__(self) -> None:
        # key -> list[(id, {field: value})]
        self._data: dict[str, list[tuple[str, dict]]] = defaultdict(list)
        self._seq: dict[str, int] = defaultdict(int)

    def xadd(self, key: str, fields: dict[str, Any], *, maxlen: int | None = None) -> str:
        # maxlen is accepted for API compatibility with redis-py; ignored in this test double
        self._seq[key] += 1
        eid = f"{self._seq[key]}-0"
        self._data[key].append((eid, fields))
        return eid

    def expire(self, key: str, seconds: int) -> None:
        # no-op for tests
        return None

    def xread(self, streams: dict[str, Any], block: int | None = None, count: int | None = None):
        assert len(streams) == 1
        key, last_id = next(iter(streams.items()))
        entries = self._data.get(key, [])
        start = 0
        if last_id != "0-0":
            for i, (eid, _f) in enumerate(entries):
                if eid == last_id:
                    start = i + 1
                    break
        if start >= len(entries):
            return []
        end = len(entries) if count is None else min(len(entries), start + count)
        return [(key, entries[start:end])]


@pytest.fixture
def _patch_get_channel_streams(monkeypatch: pytest.MonkeyPatch):
    from libs.broadcast_channel.redis.streams_channel import StreamsBroadcastChannel

    fake = _FakeStreams()
    chan = StreamsBroadcastChannel(fake, retention_seconds=60)

    def _get_channel():
        return chan

    # Patch both the source and the imported alias used by MessageGenerator
    monkeypatch.setattr("extensions.ext_redis.get_pubsub_broadcast_channel", lambda: chan)
    monkeypatch.setattr("core.app.apps.message_generator.get_pubsub_broadcast_channel", lambda: chan)
    # Ensure AppGenerateService sees streams mode
    import services.app_generate_service as ags

    monkeypatch.setattr(ags.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "streams", raising=False)


@pytest.fixture
def _patch_get_channel_pubsub(monkeypatch: pytest.MonkeyPatch):
    from libs.broadcast_channel.redis.channel import BroadcastChannel as RedisBroadcastChannel

    store: dict[str, deque[bytes]] = defaultdict(deque)
    client = _FakeRedisClient(store)
    chan = RedisBroadcastChannel(client)

    def _get_channel():
        return chan

    # Patch both the source and the imported alias used by MessageGenerator
    monkeypatch.setattr("extensions.ext_redis.get_pubsub_broadcast_channel", lambda: chan)
    monkeypatch.setattr("core.app.apps.message_generator.get_pubsub_broadcast_channel", lambda: chan)
    # Ensure AppGenerateService sees pubsub mode
    import services.app_generate_service as ags

    monkeypatch.setattr(ags.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "pubsub", raising=False)


def _publish_events(app_mode: AppMode, run_id: str, events: list[dict]):
    # Publish events to the same topic used by MessageGenerator
    topic = MessageGenerator.get_response_topic(app_mode, run_id)
    for ev in events:
        topic.publish(json.dumps(ev).encode())


@pytest.mark.usefixtures("_patch_get_channel_streams")
def test_streams_full_flow_prepublish_and_replay():
    app_mode = AppMode.WORKFLOW
    run_id = str(uuid.uuid4())

    # Build start_task that publishes two events immediately
    events = [{"event": "workflow_started"}, {"event": "workflow_finished"}]

    def start_task():
        _publish_events(app_mode, run_id, events)

    on_subscribe = AppGenerateService._build_streaming_task_on_subscribe(start_task)

    # Start retrieving BEFORE subscription is established; in streams mode, we also started immediately
    gen = MessageGenerator.retrieve_events(app_mode, run_id, idle_timeout=2.0, on_subscribe=on_subscribe)

    received = []
    for msg in gen:
        if isinstance(msg, str):
            # skip ping events
            continue
        received.append(msg)
        if msg.get("event") == "workflow_finished":
            break

    assert [m.get("event") for m in received] == ["workflow_started", "workflow_finished"]


@pytest.mark.usefixtures("_patch_get_channel_pubsub")
def test_pubsub_full_flow_start_on_subscribe_gated(monkeypatch: pytest.MonkeyPatch):
    # Speed up any potential timer if it accidentally triggers
    monkeypatch.setattr("services.app_generate_service.SSE_TASK_START_FALLBACK_MS", 50)

    app_mode = AppMode.WORKFLOW
    run_id = str(uuid.uuid4())

    published_order: list[str] = []

    def start_task():
        # When called (on subscribe), publish both events
        events = [{"event": "workflow_started"}, {"event": "workflow_finished"}]
        _publish_events(app_mode, run_id, events)
        published_order.extend([e["event"] for e in events])

    on_subscribe = AppGenerateService._build_streaming_task_on_subscribe(start_task)

    # Producer not started yet; only when subscribe happens
    assert published_order == []

    gen = MessageGenerator.retrieve_events(app_mode, run_id, idle_timeout=2.0, on_subscribe=on_subscribe)

    received = []
    for msg in gen:
        if isinstance(msg, str):
            continue
        received.append(msg)
        if msg.get("event") == "workflow_finished":
            break

    # Verify publish happened and consumer received in order
    assert published_order == ["workflow_started", "workflow_finished"]
    assert [m.get("event") for m in received] == ["workflow_started", "workflow_finished"]
