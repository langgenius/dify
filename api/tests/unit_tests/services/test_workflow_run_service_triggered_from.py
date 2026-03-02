from types import SimpleNamespace
from unittest.mock import MagicMock

from models.enums import WorkflowRunTriggeredFrom
from services.workflow_run_service import WorkflowRunService


def _new_service() -> WorkflowRunService:
    return WorkflowRunService.__new__(WorkflowRunService)


def test_get_workflow_runs_count_passes_multiple_triggered_from_to_repository() -> None:
    service = _new_service()
    repo = MagicMock()
    repo.get_workflow_runs_count.return_value = {
        "total": 5,
        "running": 1,
        "succeeded": 3,
        "failed": 1,
        "stopped": 0,
        "partial-succeeded": 0,
    }
    service._workflow_run_repo = repo  # type: ignore[attr-defined]

    triggered_from = [WorkflowRunTriggeredFrom.DEBUGGING, WorkflowRunTriggeredFrom.RERUN]
    result = service.get_workflow_runs_count(
        app_model=SimpleNamespace(tenant_id="tenant_1", id="app_1"),
        triggered_from=triggered_from,
    )

    assert result == {
        "total": 5,
        "running": 1,
        "succeeded": 3,
        "failed": 1,
        "stopped": 0,
        "partial-succeeded": 0,
    }
    repo.get_workflow_runs_count.assert_called_once()
    assert repo.get_workflow_runs_count.call_args.kwargs["triggered_from"] == triggered_from


def test_get_paginate_workflow_runs_accepts_multiple_triggered_from() -> None:
    service = _new_service()
    repo = MagicMock()
    pagination = object()
    repo.get_paginated_workflow_runs.return_value = pagination
    service._workflow_run_repo = repo  # type: ignore[attr-defined]

    result = service.get_paginate_workflow_runs(
        app_model=SimpleNamespace(tenant_id="tenant_1", id="app_1"),
        args={"limit": 20},
        triggered_from=[WorkflowRunTriggeredFrom.DEBUGGING, WorkflowRunTriggeredFrom.RERUN],
    )

    assert result is pagination
    kwargs = repo.get_paginated_workflow_runs.call_args.kwargs
    assert kwargs["triggered_from"] == [WorkflowRunTriggeredFrom.DEBUGGING, WorkflowRunTriggeredFrom.RERUN]
