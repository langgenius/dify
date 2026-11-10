"""The renewal publisher sends the real Celery task and its reservation owner."""

import pytest
from celery import Celery
from kombu.simple import SimpleQueue

from extensions.ext_application_services import application_services
from services.trigger.subscription_gateway import enqueue_subscription_refresh
from services.trigger.subscription_refresh_service import TriggerSubscriptionRefreshJob, TriggerSubscriptionRefreshRef
from tasks.trigger_subscription_refresh_tasks import trigger_subscription_refresh
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness


def test_publisher_preserves_legacy_worker_arguments_and_sends_reservation_in_headers() -> None:
    previous_app = trigger_subscription_refresh.app
    app = Celery("trigger-renewal-publisher-test", broker="memory://", set_as_current=False)
    app.conf.update(task_always_eager=False, task_serializer="json")
    app.set_current()

    # Exercise Celery's header/argument separation with the old consumer signature.
    @app.task
    def legacy_refresh(tenant_id: str, subscription_id: str) -> tuple[str, str]:
        return tenant_id, subscription_id

    job = TriggerSubscriptionRefreshJob(
        subscription=TriggerSubscriptionRefreshRef(tenant_id="tenant", subscription_id="subscription"),
        token="reservation-owner",
    )
    try:
        with app.connection_for_write() as connection:
            with SimpleQueue(connection.channel(), "trigger_refresh_executor") as queue:
                queue.clear()
                try:
                    enqueue_subscription_refresh(job)
                    message = queue.get(block=False)
                    assert message.headers["task"] == trigger_subscription_refresh.name
                    assert message.payload[1] == {
                        "tenant_id": "tenant",
                        "subscription_id": "subscription",
                    }
                    assert message.headers["reservation_token"] == "reservation-owner"
                    result = legacy_refresh.apply(
                        args=tuple(message.payload[0]),
                        kwargs=message.payload[1],
                        headers=message.headers,
                        throw=True,
                    )
                    assert result.get() == ("tenant", "subscription")
                    message.ack()
                    assert queue.qsize() == 0
                finally:
                    queue.clear()
    finally:
        previous_app.set_current()
        app.close()


@pytest.mark.parametrize("batch_size", [0, -1])
def test_invalid_batch_size_stops_before_database_or_external_io(harness: _Harness, batch_size: int) -> None:
    with harness.app.app_context(), pytest.raises(ValueError, match="batch size must be positive"):
        application_services().workspaces.trigger_subscription_refresh.enqueue_due(
            now=100, credential_threshold=10, subscription_threshold=20, batch_size=batch_size
        )
    assert not harness.metadata.sessions
