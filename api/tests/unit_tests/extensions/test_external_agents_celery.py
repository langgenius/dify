"""Real Celery routing keeps cleanup live independently of external I/O admission."""

from datetime import timedelta
from queue import Empty

import pytest
from celery.contrib.testing.app import TestApp, setup_default_app
from kombu.message import Message
from kombu.simple import SimpleQueue

from dify_app import DifyApp
from extensions.ext_celery import init_app
from tests.helpers.unit.config_override import config_overrides_context


@pytest.mark.parametrize("enabled", [False, True])
def test_external_agent_cleanup_schedule_and_isolated_delivery_routes(enabled: bool) -> None:
    with (
        setup_default_app(TestApp()),
        config_overrides_context(
            CELERY_BROKER_URL="memory://",
            CELERY_BACKEND="disabled",
            DISABLE_TELEMETRY=True,
            EXTERNAL_AGENTS_ENABLED=enabled,
            EXTERNAL_AGENTS_QUEUE="external-agents-test-runtime",
            OPS_TRACE_QUEUE="external-agents-test-export",
        ),
    ):
        app = init_app(DifyApp(__name__))
        try:
            schedule = app.conf.beat_schedule
            runtime_queue = "external-agents-test-runtime"
            export_queue = "external-agents-test-export"
            assert schedule["external_agent_maintenance"]["options"]["queue"] == runtime_queue
            assert schedule["external_agent_commands"]["options"]["queue"] == runtime_queue
            assert schedule["external_agent_commands"]["schedule"] == timedelta(seconds=1 if enabled else 5)
            with app.connection_for_write() as connection:
                # A real old cleanup envelope stays queued while BYOA publishes
                # and consumes its own commands. No worker executes either here.
                legacy_name = "schedule.clean_messages.clean_messages"
                with SimpleQueue(connection, "retention") as legacy:
                    before = legacy.qsize()
                    retained_id = app.send_task(legacy_name, args=(), queue="retention").id
                    runtime_names = (
                        "tasks.external_agent_task.drain_external_commands",
                        "tasks.external_agent_task.maintain_external_agents",
                        "tasks.external_agent_task.execute_external_command",
                    )
                    for name in runtime_names:
                        app.send_task(name, args=())
                    export_name = "tasks.external_agent_task.execute_external_trace_delivery"
                    app.send_task(export_name, args=())
                    assert legacy.qsize() == before + 1
                    preserved: list[Message] = []
                    for _ in range(legacy.qsize()):
                        message = legacy.get(block=False)
                        if message.headers["id"] == retained_id:
                            assert message.headers["task"] == legacy_name
                            message.ack()
                        else:
                            preserved.append(message)
                    for message in reversed(preserved):
                        message.reject(requeue=True)
                for queue, names in ((runtime_queue, runtime_names), (export_queue, (export_name,))):
                    with SimpleQueue(connection, queue) as inbox:
                        for name in names:
                            message = inbox.get(block=False)
                            assert message.headers["task"] == name
                            message.ack()
                        with pytest.raises(Empty):
                            inbox.get(block=False)
        finally:
            app.close()
