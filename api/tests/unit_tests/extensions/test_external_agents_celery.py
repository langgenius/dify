"""Real Celery routing keeps cleanup live independently of external I/O admission."""

from datetime import timedelta
from queue import Empty

import pytest
from celery.contrib.testing.app import TestApp, setup_default_app
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
            assert schedule["external_agent_maintenance"]["options"]["queue"] == "retention"
            assert schedule["external_agent_commands"]["options"]["queue"] == "retention"
            assert schedule["external_agent_commands"]["schedule"] == timedelta(seconds=1 if enabled else 5)
            calls = {
                "retention": "tasks.external_agent_task.maintain_external_agents",
                "external-agents-test-runtime": "tasks.external_agent_task.execute_external_command",
                "external-agents-test-export": "tasks.external_agent_task.execute_external_trace_delivery",
            }
            for name in calls.values():
                app.send_task(name, args=())
            with app.connection_for_write() as connection:
                for queue, name in calls.items():
                    with SimpleQueue(connection, queue) as inbox:
                        message = inbox.get(block=False)
                        assert message.headers["task"] == name
                        message.ack()
                        with pytest.raises(Empty):
                            inbox.get(block=False)
        finally:
            app.close()
