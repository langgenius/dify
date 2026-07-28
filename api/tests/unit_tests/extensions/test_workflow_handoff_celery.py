from datetime import timedelta
from unittest.mock import Mock

from extensions import ext_celery


def test_register_workflow_handoff_recovery_schedule(monkeypatch) -> None:
    config = Mock(WORKFLOW_HANDOFF_SCAN_INTERVAL_SECONDS=15, WORKFLOW_HANDOFF_QUEUE="handoff-v2")
    monkeypatch.setattr(ext_celery, "dify_config", config)
    imports: list[str] = []
    beat_schedule = {}

    ext_celery._register_workflow_handoff_schedule(imports=imports, beat_schedule=beat_schedule)

    assert imports == ["tasks.workflow_handoff_tasks"]
    assert beat_schedule == {
        "workflow_handoff_scan": {
            "task": "workflow_handoff.scan",
            "schedule": timedelta(seconds=15),
            "options": {"queue": "handoff-v2"},
        }
    }
