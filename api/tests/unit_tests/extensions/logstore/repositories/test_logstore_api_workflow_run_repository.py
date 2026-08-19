from __future__ import annotations

from datetime import UTC, datetime, timedelta

from extensions.logstore.repositories.logstore_api_workflow_run_repository import _dict_to_workflow_run


def test_dict_to_workflow_run_normalizes_mixed_datetime_inputs_to_naive_utc() -> None:
    started_at = datetime(2026, 8, 18, 2, 0, 0, tzinfo=UTC)
    finished_at = started_at + timedelta(seconds=30)

    model = _dict_to_workflow_run(
        {
            "id": "run-1",
            "tenant_id": "tenant-1",
            "app_id": "app-1",
            "workflow_id": "workflow-1",
            "started_at": started_at.isoformat(),
            "finished_at": finished_at.timestamp(),
        }
    )

    assert model.created_at == datetime(2026, 8, 18, 2, 0, 0)
    assert model.finished_at == datetime(2026, 8, 18, 2, 0, 30)
    assert model.elapsed_time == 30.0


def test_dict_to_workflow_run_uses_naive_utc_now_when_started_at_missing() -> None:
    finished_at = datetime(2026, 8, 18, 2, 0, 30, tzinfo=UTC)

    model = _dict_to_workflow_run(
        {
            "id": "run-1",
            "tenant_id": "tenant-1",
            "app_id": "app-1",
            "workflow_id": "workflow-1",
            "finished_at": finished_at.timestamp(),
        }
    )

    assert model.created_at.tzinfo is None
    assert model.finished_at == datetime(2026, 8, 18, 2, 0, 30)
