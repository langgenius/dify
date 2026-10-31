"""Trigger debug wiring uses actual controllers, workflows and Redis transport failures."""

from collections.abc import Iterator
from contextvars import Context
from inspect import unwrap
from uuid import uuid4

import pytest
from flask import request
from flask.typing import ResponseReturnValue
from redis import Redis
from redis.backoff import NoBackoff
from redis.retry import Retry

from controllers.console.app.workflow import (
    DraftWorkflowTriggerNodeApi,
    DraftWorkflowTriggerRunAllApi,
    DraftWorkflowTriggerRunAllPayload,
    DraftWorkflowTriggerRunApi,
    DraftWorkflowTriggerRunPayload,
)
from extensions.ext_application_services import application_services
from extensions.ext_redis import RedisClientWrapper
from models.account import Account
from models.model import App, AppMode
from models.workflow import Workflow
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


def _seed(harness: _Harness) -> str:
    app_id = str(uuid4())
    with harness.session_factory.begin() as session:
        session.add(
            App(
                id=app_id,
                tenant_id=harness.tenant_id,
                name="Debug",
                mode=AppMode.WORKFLOW,
                enable_site=True,
                enable_api=True,
            )
        )
        session.add(
            Workflow.new(
                tenant_id=harness.tenant_id,
                app_id=app_id,
                type="workflow",
                version=Workflow.VERSION_DRAFT,
                graph='{"nodes":[{"id":"webhook","data":{"type":"trigger-webhook","title":"Webhook"}}]}',
                features="{}",
                created_by=harness.account_id,
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )
        )
    return app_id


@pytest.mark.parametrize("entrypoint", ["full", "node", "all"])
def test_controller_uses_composed_debug_service_for_waiting_response(harness: _Harness, entrypoint: str) -> None:
    app_id = _seed(harness)

    def poll() -> ResponseReturnValue:
        with harness.session_factory() as session:
            app = session.get(App, app_id)
            account = session.get(Account, harness.account_id)
            assert app is not None
            assert account is not None
            if entrypoint == "full":
                resource = DraftWorkflowTriggerRunApi()
                return unwrap(resource.post)(
                    resource, DraftWorkflowTriggerRunPayload.model_validate(request.get_json()), session, account, app
                )
            if entrypoint == "node":
                resource = DraftWorkflowTriggerNodeApi()
                return unwrap(resource.post)(resource, account, app, "webhook")
            resource = DraftWorkflowTriggerRunAllApi()
            return unwrap(resource.post)(
                resource, DraftWorkflowTriggerRunAllPayload.model_validate(request.get_json()), session, account, app
            )

    harness.app.add_url_rule("/debug-wiring", view_func=poll, methods=["POST"])
    payload = {"node_ids": ["webhook"]} if entrypoint == "all" else {"node_id": "webhook"}
    response = Context().run(harness.client.post, "/debug-wiring", json=payload)
    assert response.status_code == 200
    assert response.get_json() == {"status": "waiting", "retry_in": 2000}


def test_unsupported_node_keeps_validation_error(harness: _Harness) -> None:
    with harness.app.app_context():
        from graphon.entities.graph_config import NodeConfigDictAdapter

        with pytest.raises(ValueError, match="unable to create event poller for node type start"):
            application_services().workspaces.trigger_debug.poll(
                node_config=NodeConfigDictAdapter.validate_python(
                    {"id": "start", "data": {"type": "start", "title": "Start"}}
                ),
                tenant_id=harness.tenant_id,
                user_id=harness.account_id,
                app_id=str(uuid4()),
            )
