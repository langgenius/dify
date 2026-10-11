from datetime import UTC, datetime

from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.enums import WorkflowRunTriggeredFrom
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.workflow_statistic_query_service import WorkflowStatisticQueryService


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def test_workflow_statistic_queries_delegate_to_workflow_run_repository(
    sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture
) -> None:
    workflow_runs = DifyAPISQLAlchemyWorkflowRunRepository(session_maker=sqlite_session_factory)
    get_daily_runs_statistics = mocker.patch.object(
        workflow_runs, "get_daily_runs_statistics", return_value=[{"date": "2024-01-01", "runs": 2}]
    )
    get_daily_terminals_statistics = mocker.patch.object(
        workflow_runs, "get_daily_terminals_statistics", return_value=[{"date": "2024-01-01", "terminal_count": 3}]
    )
    get_daily_token_cost_statistics = mocker.patch.object(
        workflow_runs, "get_daily_token_cost_statistics", return_value=[{"date": "2024-01-01", "token_count": 4}]
    )
    get_average_app_interaction_statistics = mocker.patch.object(
        workflow_runs,
        "get_average_app_interaction_statistics",
        return_value=[{"date": "2024-01-01", "interactions": 2.5}],
    )
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
    get_daily_runs_statistics.assert_called_once_with(**expected_arguments)
    get_daily_terminals_statistics.assert_called_once_with(**expected_arguments)
    get_daily_token_cost_statistics.assert_called_once_with(**expected_arguments)
    get_average_app_interaction_statistics.assert_called_once_with(**expected_arguments)
