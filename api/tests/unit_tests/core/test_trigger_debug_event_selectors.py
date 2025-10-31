import hashlib
import json
from datetime import UTC, datetime

import pytest
import pytz

from core.trigger.debug import event_selectors
from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig


class _DummyRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    def get(self, key: str):
        return self.store.get(key)

    def setex(self, name: str, time: int, value: str):
        self.store[name] = value

    def expire(self, name: str, ttl: int):
        # Expiration not required for these tests.
        pass

    def delete(self, name: str):
        self.store.pop(name, None)


@pytest.fixture
def dummy_schedule_config() -> ScheduleConfig:
    return ScheduleConfig(
        node_id="node-1",
        cron_expression="* * * * *",
        timezone="Asia/Shanghai",
    )


@pytest.fixture(autouse=True)
def patch_schedule_service(monkeypatch: pytest.MonkeyPatch, dummy_schedule_config: ScheduleConfig):
    # Ensure poller always receives the deterministic config.
    monkeypatch.setattr(
        "services.trigger.schedule_service.ScheduleService.to_schedule_config",
        staticmethod(lambda *_args, **_kwargs: dummy_schedule_config),
    )


def _make_poller(
    monkeypatch: pytest.MonkeyPatch, redis_client: _DummyRedis
) -> event_selectors.ScheduleTriggerDebugEventPoller:
    monkeypatch.setattr(event_selectors, "redis_client", redis_client)
    return event_selectors.ScheduleTriggerDebugEventPoller(
        tenant_id="tenant-1",
        user_id="user-1",
        app_id="app-1",
        node_config={"id": "node-1", "data": {"mode": "cron"}},
        node_id="node-1",
    )


def test_schedule_poller_handles_aware_next_run(monkeypatch: pytest.MonkeyPatch):
    redis_client = _DummyRedis()
    poller = _make_poller(monkeypatch, redis_client)

    base_now = datetime(2025, 1, 1, 12, 0, 10)
    aware_next_run = datetime(2025, 1, 1, 12, 0, 5, tzinfo=UTC)

    monkeypatch.setattr(event_selectors, "naive_utc_now", lambda: base_now)
    monkeypatch.setattr(event_selectors, "calculate_next_run_at", lambda *_: aware_next_run)

    event = poller.poll()

    assert event is not None
    assert event.node_id == "node-1"
    assert event.workflow_args["inputs"] == {}


def test_schedule_runtime_cache_normalizes_timezone(
    monkeypatch: pytest.MonkeyPatch, dummy_schedule_config: ScheduleConfig
):
    redis_client = _DummyRedis()
    poller = _make_poller(monkeypatch, redis_client)

    localized_time = pytz.timezone("Asia/Shanghai").localize(datetime(2025, 1, 1, 20, 0, 0))

    cron_hash = hashlib.sha256(dummy_schedule_config.cron_expression.encode()).hexdigest()
    cache_key = poller.schedule_debug_runtime_key(cron_hash)

    redis_client.store[cache_key] = json.dumps(
        {
            "cache_key": cache_key,
            "timezone": dummy_schedule_config.timezone,
            "cron_expression": dummy_schedule_config.cron_expression,
            "next_run_at": localized_time.isoformat(),
        }
    )

    runtime = poller.get_or_create_schedule_debug_runtime()

    expected = localized_time.astimezone(UTC).replace(tzinfo=None)
    assert runtime.next_run_at == expected
    assert runtime.next_run_at.tzinfo is None
