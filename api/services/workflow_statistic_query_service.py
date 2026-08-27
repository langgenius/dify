"""Application service for workflow statistic queries."""

from datetime import datetime

from machinery.context import RequestContext
from models.enums import WorkflowRunTriggeredFrom
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.types import (
    AverageInteractionStats,
    DailyRunsStats,
    DailyTerminalsStats,
    DailyTokenCostStats,
)


class WorkflowStatisticQueryService:
    def __init__(self, *, workflow_runs: APIWorkflowRunRepository) -> None:
        self._workflow_runs = workflow_runs

    def get_daily_runs(
        self,
        context: RequestContext,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> list[DailyRunsStats]:
        return self._workflow_runs.get_daily_runs_statistics(
            tenant_id=self._workspace_id(context),
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

    def get_daily_terminals(
        self,
        context: RequestContext,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> list[DailyTerminalsStats]:
        return self._workflow_runs.get_daily_terminals_statistics(
            tenant_id=self._workspace_id(context),
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

    def get_daily_token_costs(
        self,
        context: RequestContext,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> list[DailyTokenCostStats]:
        return self._workflow_runs.get_daily_token_cost_statistics(
            tenant_id=self._workspace_id(context),
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

    def get_average_app_interactions(
        self,
        context: RequestContext,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> list[AverageInteractionStats]:
        return self._workflow_runs.get_average_app_interaction_statistics(
            tenant_id=self._workspace_id(context),
            app_id=app_id,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

    @staticmethod
    def _workspace_id(context: RequestContext) -> str:
        workspace_id = context.active_workspace_id
        if workspace_id is None:
            raise RuntimeError("Console account admission did not resolve an active workspace")
        return workspace_id
