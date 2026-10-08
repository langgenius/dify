"""Abandoned debug handoffs are recovered without enabling run-log cleanup."""

from datetime import timedelta

import pytest
from celery import current_app

from dify_app import DifyApp
from extensions.ext_celery import init_app
from tests.unit_tests.config_override import apply_config_overrides


@pytest.mark.parametrize("enabled", [True, False])
def test_debug_reservation_recovery_schedule(monkeypatch: pytest.MonkeyPatch, enabled: bool) -> None:
    restore_default = current_app.set_default
    restore_current = current_app.set_current
    apply_config_overrides(
        monkeypatch,
        ENABLE_WORKFLOW_DEBUG_RESERVATION_CLEANUP_TASK=enabled,
        ENABLE_WORKFLOW_RUN_CLEANUP_TASK=False,
    )
    application = init_app(DifyApp(__name__))
    try:
        if enabled:
            assert application.conf.beat_schedule["workflow_debug_reservation_cleanup"] == {
                "task": "tasks.workflow_debug_reservation_tasks.recover_workflow_debug_reservations",
                "schedule": timedelta(minutes=1),
            }
            assert "tasks.workflow_debug_reservation_tasks" in application.conf.imports
        else:
            assert "workflow_debug_reservation_cleanup" not in application.conf.beat_schedule
    finally:
        application.close()
        restore_default()
        restore_current()
