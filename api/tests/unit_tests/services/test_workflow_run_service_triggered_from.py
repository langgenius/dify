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
    pagination = SimpleNamespace(data=[], has_more=False, limit=20)
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


def test_get_workflow_run_attaches_rerun_source_summary() -> None:
    service = _new_service()
    repo = MagicMock()
    repo.get_workflow_run_by_id.side_effect = [
        SimpleNamespace(
            id="run_1",
            rerun_from_workflow_run_id="source_1",
            rerun_from_node_id="node_1",
            graph_dict={
                "nodes": [
                    {
                        "id": "node_1",
                        "data": {"title": "Knowledge Retrieval"},
                    }
                ]
            },
        ),
        SimpleNamespace(
            id="source_1",
            status="succeeded",
            finished_at=1704067200,
        ),
    ]
    service._workflow_run_repo = repo  # type: ignore[attr-defined]

    result = service.get_workflow_run(
        app_model=SimpleNamespace(tenant_id="tenant_1", id="app_1"),
        run_id="run_1",
    )

    assert result is not None
    assert result.rerun_source_workflow_run == {
        "id": "source_1",
        "status": "succeeded",
        "finished_at": 1704067200,
    }
    assert result.rerun_from_node_title == "Knowledge Retrieval"
    assert repo.get_workflow_run_by_id.call_count == 2


def test_get_paginate_workflow_runs_attaches_rerun_source_summary() -> None:
    service = _new_service()
    repo = MagicMock()
    pagination = SimpleNamespace(
        data=[
            SimpleNamespace(
                id="run_1",
                rerun_from_workflow_run_id="source_1",
                rerun_from_node_id="node_2",
                graph_dict={
                    "nodes": [
                        {
                            "id": "node_2",
                            "data": {"title": "Code"},
                        }
                    ]
                },
            ),
            SimpleNamespace(id="run_2", rerun_from_workflow_run_id=None, rerun_from_node_id=None),
        ],
        has_more=False,
        limit=20,
    )
    repo.get_paginated_workflow_runs.return_value = pagination
    repo.get_workflow_run_by_id.return_value = SimpleNamespace(
        id="source_1",
        status="failed",
        finished_at=1704067201,
    )
    service._workflow_run_repo = repo  # type: ignore[attr-defined]

    result = service.get_paginate_workflow_runs(
        app_model=SimpleNamespace(tenant_id="tenant_1", id="app_1"),
        args={"limit": 20},
        triggered_from=[WorkflowRunTriggeredFrom.DEBUGGING, WorkflowRunTriggeredFrom.RERUN],
    )

    assert result is pagination
    assert result.data[0].rerun_source_workflow_run == {
        "id": "source_1",
        "status": "failed",
        "finished_at": 1704067201,
    }
    assert result.data[0].rerun_from_node_title == "Code"
    assert result.data[1].rerun_source_workflow_run is None
    assert result.data[1].rerun_from_node_title is None
    repo.get_workflow_run_by_id.assert_called_once_with(
        tenant_id="tenant_1",
        app_id="app_1",
        run_id="source_1",
    )


def test_get_workflow_run_skips_source_lookup_when_not_rerun() -> None:
    service = _new_service()
    repo = MagicMock()
    repo.get_workflow_run_by_id.return_value = SimpleNamespace(
        id="run_1",
        rerun_from_workflow_run_id=None,
        rerun_from_node_id=None,
    )
    service._workflow_run_repo = repo  # type: ignore[attr-defined]

    result = service.get_workflow_run(
        app_model=SimpleNamespace(tenant_id="tenant_1", id="app_1"),
        run_id="run_1",
    )

    assert result is not None
    assert result.rerun_source_workflow_run is None
    repo.get_workflow_run_by_id.assert_called_once_with(
        tenant_id="tenant_1",
        app_id="app_1",
        run_id="run_1",
    )


def test_get_paginate_workflow_runs_skips_source_lookup_when_not_rerun() -> None:
    service = _new_service()
    repo = MagicMock()
    pagination = SimpleNamespace(
        data=[
            SimpleNamespace(id="run_1", rerun_from_workflow_run_id=None, rerun_from_node_id=None),
            SimpleNamespace(id="run_2", rerun_from_workflow_run_id=None, rerun_from_node_id=None),
        ],
        has_more=False,
        limit=20,
    )
    repo.get_paginated_workflow_runs.return_value = pagination
    service._workflow_run_repo = repo  # type: ignore[attr-defined]

    result = service.get_paginate_workflow_runs(
        app_model=SimpleNamespace(tenant_id="tenant_1", id="app_1"),
        args={"limit": 20},
        triggered_from=[WorkflowRunTriggeredFrom.DEBUGGING, WorkflowRunTriggeredFrom.RERUN],
    )

    assert result is pagination
    assert result.data[0].rerun_source_workflow_run is None
    assert result.data[1].rerun_source_workflow_run is None
    repo.get_workflow_run_by_id.assert_not_called()
