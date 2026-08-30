from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from machinery.context import RequestContext
from models.enums import WorkflowRunTriggeredFrom
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from services.workflow_statistic_query_service import WorkflowStatisticQueryService


def _request_context(*, workspace_id: str | None = "workspace-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=workspace_id,
    )


def test_workflow_statistic_queries_delegate_to_workflow_run_repository() -> None:
    workflow_runs = MagicMock(spec=APIWorkflowRunRepository)
    workflow_runs.get_daily_runs_statistics.return_value = [{"date": "2024-01-01", "runs": 2}]
    workflow_runs.get_daily_terminals_statistics.return_value = [{"date": "2024-01-01", "terminal_count": 3}]
    workflow_runs.get_daily_token_cost_statistics.return_value = [{"date": "2024-01-01", "token_count": 4}]
    workflow_runs.get_average_app_interaction_statistics.return_value = [{"date": "2024-01-01", "interactions": 2.5}]
    service = WorkflowStatisticQueryService(workflow_runs=workflow_runs)
    context = _request_context()
    start_date = datetime(2024, 1, 1, tzinfo=UTC)
    end_date = datetime(2024, 1, 2, tzinfo=UTC)

    assert service.get_daily_runs(
        context,
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == [{"date": "2024-01-01", "runs": 2}]
    assert service.get_daily_terminals(
        context,
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == [{"date": "2024-01-01", "terminal_count": 3}]
    assert service.get_daily_token_costs(
        context,
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == [{"date": "2024-01-01", "token_count": 4}]
    assert service.get_average_app_interactions(
        context,
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == [{"date": "2024-01-01", "interactions": 2.5}]

    expected_arguments = {
        "tenant_id": "workspace-1",
        "app_id": "app-1",
        "triggered_from": WorkflowRunTriggeredFrom.APP_RUN,
        "start_date": start_date,
        "end_date": end_date,
        "timezone": "Asia/Shanghai",
    }
    workflow_runs.get_daily_runs_statistics.assert_called_once_with(**expected_arguments)
    workflow_runs.get_daily_terminals_statistics.assert_called_once_with(**expected_arguments)
    workflow_runs.get_daily_token_cost_statistics.assert_called_once_with(**expected_arguments)
    workflow_runs.get_average_app_interaction_statistics.assert_called_once_with(**expected_arguments)


def test_workflow_statistic_query_requires_active_workspace() -> None:
    workflow_runs = MagicMock(spec=APIWorkflowRunRepository)
    service = WorkflowStatisticQueryService(workflow_runs=workflow_runs)

    with pytest.raises(RuntimeError, match="did not resolve an active workspace"):
        service.get_daily_runs(
            _request_context(workspace_id=None),
            app_id="app-1",
            start_date=None,
            end_date=None,
            timezone="UTC",
        )

    workflow_runs.get_daily_runs_statistics.assert_not_called()
