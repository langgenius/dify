"""Recovery remains scheduled even when initial cleanup delivery fails."""

from datetime import timedelta

import pytest
from celery import current_app

from dify_app import DifyApp
from extensions.ext_celery import init_app
from tests.unit_tests.config_override import apply_config_overrides


@pytest.mark.parametrize("enabled", [True, False])
def test_draft_cleanup_recovery_schedule(monkeypatch: pytest.MonkeyPatch, enabled: bool) -> None:
    restore_default = current_app.set_default
    restore_current = current_app.set_current
    apply_config_overrides(
        monkeypatch,
        ENABLE_WORKFLOW_DRAFT_FILE_CLEANUP_TASK=enabled,
        WORKFLOW_DRAFT_FILE_CLEANUP_INTERVAL=7,
    )
    application = init_app(DifyApp(__name__))
    try:
        schedules = application.conf.beat_schedule
        if enabled:
            assert schedules["workflow_draft_file_cleanup"] == {
                "task": "tasks.workflow_draft_var_tasks.recover_draft_variable_file_cleanup_task",
                "schedule": timedelta(minutes=7),
            }
            assert "tasks.workflow_draft_var_tasks" in application.conf.imports
        else:
            assert "workflow_draft_file_cleanup" not in schedules
    finally:
        application.close()
        restore_default()
        restore_current()
