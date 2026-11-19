"""The endpoint publisher preserves the worker's real Celery contract."""

from celery import Celery
from kombu.simple import SimpleQueue

from services.trigger.endpoint_gateway import enqueue_triggered_workflows
from services.workflow.entities import PluginTriggerDispatchData
from tasks.trigger_processing_tasks import TRIGGER_QUEUE, dispatch_triggered_workflows_async


def test_enqueue_triggered_workflows_publishes_worker_payload_to_existing_queue() -> None:
    data = PluginTriggerDispatchData(
        user_id="plugin-user",
        tenant_id="tenant-id",
        endpoint_id="endpoint-id",
        provider_id="langgenius/github/github",
        subscription_id="subscription-id",
        timestamp=1234567890,
        events=["push", "push"],
        request_id="trigger_request_1234567890_abcdef012345",
    )
    previous_app = dispatch_triggered_workflows_async.app
    celery_app = Celery("trigger-endpoint-publisher-test", broker="memory://", set_as_current=False)
    celery_app.conf.update(task_always_eager=False, task_serializer="json")
    celery_app.set_current()
    try:
        with celery_app.connection_for_write() as connection:
            with SimpleQueue(connection.channel(), TRIGGER_QUEUE) as queue:
                queue.clear()
                try:
                    enqueue_triggered_workflows(data)

                    message = queue.get(block=False)
                    assert message.headers["task"] == dispatch_triggered_workflows_async.name
                    assert message.delivery_info["routing_key"] == TRIGGER_QUEUE
                    assert message.content_type == "application/json"
                    assert message.payload[0] == [data.model_dump(mode="json")]
                    assert message.payload[1] == {}
                    message.ack()
                    assert queue.qsize() == 0
                finally:
                    queue.clear()
    finally:
        previous_app.set_current()
        celery_app.close()
