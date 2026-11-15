"""Execute the Redis Lua debug bus and schedule state against real Redis."""

import hashlib
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from flask import Flask

from extensions.ext_application_services import application_services
from extensions.ext_redis import redis_client
from graphon.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from repositories.trigger.debug_repository import RedisTriggerDebugRepository
from services.trigger.debug_events import WebhookDebugEvent, build_webhook_pool_key
from services.trigger.debug_service import TriggerDebugService
from services.trigger.debug_store import ScheduleDebugRuntime


@pytest.fixture
def events(flask_app_with_containers: Flask) -> Iterator[RedisTriggerDebugRepository]:
    with flask_app_with_containers.app_context():
        yield RedisTriggerDebugRepository(redis=redis_client)


def test_event_delivery_is_once_per_registered_address_and_scoped(events: RedisTriggerDebugRepository) -> None:
    tenant, other_tenant, app = str(uuid4()), str(uuid4()), str(uuid4())
    pool = build_webhook_pool_key(tenant, app, "node")
    other_pool = build_webhook_pool_key(other_tenant, app, "node")
    for user in ["one", "two"]:
        assert events.poll(WebhookDebugEvent, pool, tenant, user, app, "node") is None
    # A different app and node get independent pools/inboxes, including when
    # the same user has several inspectors open.
    assert events.poll(WebhookDebugEvent, other_pool, other_tenant, "one", app, "node") is None
    event = WebhookDebugEvent(timestamp=1, request_id="request", node_id="node", payload={"inputs": {"x": 1}})
    assert events.dispatch(tenant, event, pool) == 2
    assert events.dispatch(tenant, event, pool) == 0
    assert events.poll(WebhookDebugEvent, other_pool, other_tenant, "one", app, "node") is None
    assert (
        events.poll(
            WebhookDebugEvent, build_webhook_pool_key(tenant, "other-app", "node"), tenant, "one", "other-app", "node"
        )
        is None
    )
    for user in ["one", "two"]:
        assert events.poll(WebhookDebugEvent, pool, tenant, user, app, "node") == event
        assert events.poll(WebhookDebugEvent, pool, tenant, user, app, "node") is None


def test_event_expiry_is_bounded(events: RedisTriggerDebugRepository) -> None:
    tenant, app = str(uuid4()), str(uuid4())
    pool = build_webhook_pool_key(tenant, app, "node")
    assert events.poll(WebhookDebugEvent, pool, tenant, "user", app, "node") is None
    assert 0 < redis_client.ttl(pool) <= 300
    event = WebhookDebugEvent(timestamp=1, request_id="request", node_id="node")
    assert events.dispatch(tenant, event, pool) == 1
    address = hashlib.sha256(f"user|{app}|node".encode()).hexdigest()
    assert 0 < redis_client.ttl(f"trigger_debug_inbox:{{{tenant}}}:{address}") <= 300


def test_schedule_runtime_refreshes_ttl_and_consumes_due_event(events: RedisTriggerDebugRepository) -> None:
    tenant, app = str(uuid4()), str(uuid4())
    now = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)
    runtime = TriggerDebugService(
        events=events,
        schedules=events,
        invoke_plugin_event=application_services().triggers.events.invoke_debug,
        now=lambda: now,
    )
    node = NodeConfigDictAdapter.validate_python(
        {
            "id": "schedule",
            "data": {
                "type": "trigger-schedule",
                "title": "Schedule",
                "mode": "visual",
                "frequency": "daily",
                "visual_config": {"time": "3:00 PM"},
                "timezone": "UTC",
            },
        }
    )
    assert runtime.poll(node_config=node, tenant_id=tenant, user_id="user", app_id=app) is None
    cron_hash = hashlib.sha256(b"0 15 * * *").hexdigest()
    key = f"schedule_debug_runtime:{tenant}:user:{app}:schedule:{cron_hash}"
    cached = events.get_runtime(key)
    assert cached is not None
    assert cached.next_run_at == datetime(2026, 10, 24, 15, 0)
    redis_client.expire(key, 5)
    assert runtime.poll(node_config=node, tenant_id=tenant, user_id="user", app_id=app) is None
    assert redis_client.ttl(key) > 5
    events.save_runtime(
        ScheduleDebugRuntime(
            cache_key=key,
            timezone="UTC",
            cron_expression="0 15 * * *",
            next_run_at=now - timedelta(seconds=1),
        )
    )
    event = runtime.poll(node_config=node, tenant_id=tenant, user_id="user", app_id=app)
    assert event is not None
    assert event.workflow_args == {"inputs": {}, "files": []}
    assert events.get_runtime(key) is None


def test_schedule_runtime_handles_timezone_aware_cached_times(events: RedisTriggerDebugRepository) -> None:
    tenant, app = str(uuid4()), str(uuid4())
    now = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)
    debug = TriggerDebugService(
        events=events,
        schedules=events,
        invoke_plugin_event=application_services().triggers.events.invoke_debug,
        now=lambda: now.replace(tzinfo=None),
    )
    node = NodeConfigDictAdapter.validate_python(
        {
            "id": "schedule",
            "data": {
                "type": "trigger-schedule",
                "title": "Schedule",
                "mode": "cron",
                "cron_expression": "* * * * *",
                "timezone": "Asia/Shanghai",
            },
        }
    )
    cron_hash = hashlib.sha256(b"* * * * *").hexdigest()
    key = f"schedule_debug_runtime:{tenant}:user:{app}:schedule:{cron_hash}"
    events.save_runtime(
        ScheduleDebugRuntime(
            cache_key=key,
            timezone="Asia/Shanghai",
            cron_expression="* * * * *",
            next_run_at=now - timedelta(seconds=1),
        )
    )

    event = debug.poll(node_config=node, tenant_id=tenant, user_id="user", app_id=app)

    assert event is not None
    assert event.node_id == "schedule"
    assert events.get_runtime(key) is None


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"inputs": {}}, {}),
        ({"inputs": {"zero": 0, "empty": []}}, {"zero": 0, "empty": []}),
        (
            {"webhook_data": {"headers": {}, "query_params": {}, "body": {"x": 1}}},
            {
                "webhook_data": {"headers": {}, "query_params": {}, "body": {"x": 1}},
                "webhook_body": {"x": 1},
                "webhook_headers": {},
                "webhook_query_params": {},
            },
        ),
    ],
)
def test_webhook_payload_and_first_available_selection(
    events: RedisTriggerDebugRepository, payload: dict[str, object], expected: dict[str, object]
) -> None:
    tenant, app = str(uuid4()), str(uuid4())
    debug = application_services().triggers.debug
    node = NodeConfigDictAdapter.validate_python(
        {"id": "webhook", "data": {"type": "trigger-webhook", "title": "Webhook"}}
    )
    assert debug.poll(node_config=node, tenant_id=tenant, user_id="user", app_id=app) is None
    event = WebhookDebugEvent(timestamp=1, request_id="request", node_id="webhook", payload=payload)
    assert events.dispatch(tenant, event, build_webhook_pool_key(tenant, app, "webhook")) == 1

    def nodes() -> Iterator[NodeConfigDict]:
        yield node
        raise AssertionError("Selection must stop after its first event")

    received = debug.select_events(node_configs=nodes(), tenant_id=tenant, user_id="user", app_id=app)
    assert received is not None
    assert received.workflow_args == {"inputs": expected, "files": []}
    assert debug.poll(node_config=node, tenant_id=tenant, user_id="user", app_id=app) is None
