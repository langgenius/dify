"""Trigger debug wiring uses actual controllers, workflows and Redis transport failures."""

from collections.abc import Iterator
from uuid import uuid4

import pytest
from redis import Redis
from redis.backoff import NoBackoff
from redis.retry import Retry

from extensions.ext_application_services import application_services
from extensions.ext_redis import RedisClientWrapper
from repositories.trigger.debug_repository import RedisTriggerDebugRepository
from services.trigger.debug_events import WebhookDebugEvent, build_webhook_pool_key
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness

harness = test_trigger_oauth_client.harness


@pytest.fixture
def application_redis() -> Iterator[RedisClientWrapper]:
    # A real refused connection verifies best-effort polling without requiring
    # a server or replacing the Redis transport with a mock.
    with Redis(host="127.0.0.1", port=0, socket_connect_timeout=0.01, retry=Retry(NoBackoff(), 0)) as client:
        redis = RedisClientWrapper()
        redis.initialize(client)
        yield redis


def test_event_bus_redis_failure_is_best_effort(application_redis: RedisClientWrapper) -> None:
    events = RedisTriggerDebugRepository(redis=application_redis)
    pool = build_webhook_pool_key("tenant", "app", "node")
    event = WebhookDebugEvent(timestamp=1, request_id="request", node_id="node")
    assert events.dispatch(tenant_id="tenant", event=event, pool_key=pool) == 0
    assert events.poll(WebhookDebugEvent, pool, "tenant", "user", "app", "node") is None


def test_webhook_dispatch_returns_zero_when_redis_is_unavailable(harness: _Harness) -> None:
    event = WebhookDebugEvent(timestamp=1, request_id="request", node_id="node")
    with harness.app.app_context():
        assert (
            application_services().triggers.debug.dispatch_webhook_debug(
                tenant_id=harness.tenant_id, app_id=str(uuid4()), event=event
            )
            == 0
        )


def test_unsupported_node_keeps_validation_error(harness: _Harness) -> None:
    with harness.app.app_context():
        from graphon.entities.graph_config import NodeConfigDictAdapter

        with pytest.raises(ValueError, match="unable to create event poller for node type start"):
            application_services().triggers.debug.poll(
                node_config=NodeConfigDictAdapter.validate_python(
                    {"id": "start", "data": {"type": "start", "title": "Start"}}
                ),
                tenant_id=harness.tenant_id,
                user_id=harness.account_id,
                app_id=str(uuid4()),
            )
