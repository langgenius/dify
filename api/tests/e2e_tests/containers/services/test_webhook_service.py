"""Native debug HTTP uses the real Redis waiting pool and never queues workflow execution."""

from contextvars import Context
from http import HTTPStatus
from uuid import uuid4

import pytest
from sqlalchemy import select

from extensions.ext_redis import RedisClientWrapper
from models.enums import AppTriggerStatus
from models.model import EndUser
from models.trigger import AppTrigger, WorkflowTriggerLog
from models.utils.trigger_endpoint import generate_webhook_trigger_endpoint
from repositories.trigger.debug_repository import RedisTriggerDebugRepository
from services.trigger.debug_events import WebhookDebugEvent, build_webhook_pool_key
from tests.e2e_tests.containers.services import test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness
from tests.unit_tests.controllers.trigger import test_webhook
from tests.unit_tests.controllers.trigger.test_webhook import _configure, _Webhook

application_redis = test_trigger_subscription_builder.application_redis
sqlite_engine = test_trigger_subscription_builder.sqlite_engine
sqlite_session_factory = test_trigger_subscription_builder.sqlite_session_factory
harness = test_trigger_oauth_client.harness
webhook = test_webhook.webhook


@pytest.mark.parametrize("listener", ["absent", "other-app", "matching"])
def test_debug_http_requires_matching_listener_and_preserves_draft_response(
    harness: _Harness, webhook: _Webhook, listener: str, application_redis: RedisClientWrapper
) -> None:
    events = RedisTriggerDebugRepository(redis=application_redis)
    _configure(harness, webhook, status_code=202, response_body='["accepted"]')
    with harness.session_factory.begin() as session:
        trigger = session.get(AppTrigger, webhook.trigger_id)
        assert trigger is not None
        trigger.status = AppTriggerStatus.DISABLED
    listener_app = str(uuid4()) if listener == "other-app" else webhook.app_id
    pool_key = build_webhook_pool_key(tenant_id=harness.tenant_id, app_id=listener_app, node_id=webhook.node_id)
    if listener != "absent":
        assert (
            events.poll(
                event_type=WebhookDebugEvent,
                pool_key=pool_key,
                tenant_id=harness.tenant_id,
                user_id=harness.account_id,
                app_id=listener_app,
                node_id=webhook.node_id,
            )
            is None
        )

    response = Context().run(harness.client.post, webhook.debug_url, json={"ref": "main"})

    if listener == "matching":
        assert response.status_code == HTTPStatus.ACCEPTED
        assert response.get_json() == ["accepted"]
        event = events.poll(
            event_type=WebhookDebugEvent,
            pool_key=pool_key,
            tenant_id=harness.tenant_id,
            user_id=harness.account_id,
            app_id=webhook.app_id,
            node_id=webhook.node_id,
        )
        assert event is not None
        assert event.node_id == webhook.node_id
        assert event.request_id.startswith(f"webhook_debug_{webhook.webhook_id}_")
        assert event.timestamp > 0
        assert event.payload["method"] == "POST"
        assert event.payload["webhook_data"]["body"] == {"ref": "main"}
        assert event.payload["inputs"]["webhook_body"] == {"ref": "main"}
    else:
        assert response.status_code == HTTPStatus.CONFLICT
        assert response.get_json() == {
            "error": "No active debug listener",
            "message": (
                "The webhook debug URL only works while the Variable Inspector is listening. "
                "Use the published webhook URL to execute the workflow in Celery."
            ),
            "execution_url": generate_webhook_trigger_endpoint(webhook.webhook_id),
        }
    with harness.session_factory() as session:
        assert session.scalar(select(EndUser)) is None
        assert session.scalar(select(WorkflowTriggerLog)) is None
