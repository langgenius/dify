from datetime import datetime

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import BadRequest

from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.datetime_utils import parse_time_range
from libs.helper import dump_response
from libs.login import current_account_with_tenant
from machinery.context import RequestContext
from models.model import App, AppMode


class WorkflowStatisticQuery(BaseModel):
    start: str | None = Field(default=None, description="Start date and time (YYYY-MM-DD HH:MM)")
    end: str | None = Field(default=None, description="End date and time (YYYY-MM-DD HH:MM)")

    @field_validator("start", "end", mode="before")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        if value == "":
            return None
        return value


class WorkflowDailyRunsStatisticItem(ResponseModel):
    date: str
    runs: int


class WorkflowDailyRunsStatisticResponse(ResponseModel):
    data: list[WorkflowDailyRunsStatisticItem]


class WorkflowDailyTerminalsStatisticItem(ResponseModel):
    date: str
    terminal_count: int


class WorkflowDailyTerminalsStatisticResponse(ResponseModel):
    data: list[WorkflowDailyTerminalsStatisticItem]


class WorkflowDailyTokenCostStatisticItem(ResponseModel):
    date: str
    token_count: int


class WorkflowDailyTokenCostStatisticResponse(ResponseModel):
    data: list[WorkflowDailyTokenCostStatisticItem]


class WorkflowAverageAppInteractionStatisticItem(ResponseModel):
    date: str
    interactions: float


class WorkflowAverageAppInteractionStatisticResponse(ResponseModel):
    data: list[WorkflowAverageAppInteractionStatisticItem]


register_schema_models(console_ns, WorkflowStatisticQuery)
register_response_schema_models(
    console_ns,
    WorkflowDailyRunsStatisticResponse,
    WorkflowDailyTerminalsStatisticResponse,
    WorkflowDailyTokenCostStatisticResponse,
    WorkflowAverageAppInteractionStatisticResponse,
)


def _resolve_statistic_time_range(
    req_data: WorkflowStatisticQuery,
) -> tuple[datetime | None, datetime | None, str]:
    timezone = current_account_with_tenant().account.timezone
    assert timezone is not None

    try:
        start_date, end_date = parse_time_range(req_data.start, req_data.end, timezone)
    except ValueError as error:
        raise BadRequest(str(error)) from error

    return start_date, end_date, timezone


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/daily-conversations")
class WorkflowDailyRunsStatistic(Resource):
    @console_ns.doc("get_workflow_daily_runs_statistic")
    @console_ns.doc(description="Get workflow daily runs statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowStatisticQuery))
    @console_ns.response(
        200,
        "Daily runs statistics retrieved successfully",
        console_ns.models[WorkflowDailyRunsStatisticResponse.__name__],
    )
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @get_app_model
    @model_validate(WorkflowStatisticQuery)
    def get(self, req_data: WorkflowStatisticQuery, request_context: RequestContext, app_model: App):
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().workflow_statistics.get_daily_runs(
            request_context,
            app_id=app_model.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(WorkflowDailyRunsStatisticResponse, {"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/daily-terminals")
class WorkflowDailyTerminalsStatistic(Resource):
    @console_ns.doc("get_workflow_daily_terminals_statistic")
    @console_ns.doc(description="Get workflow daily terminals statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowStatisticQuery))
    @console_ns.response(
        200,
        "Daily terminals statistics retrieved successfully",
        console_ns.models[WorkflowDailyTerminalsStatisticResponse.__name__],
    )
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @get_app_model
    @model_validate(WorkflowStatisticQuery)
    def get(self, req_data: WorkflowStatisticQuery, request_context: RequestContext, app_model: App):
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().workflow_statistics.get_daily_terminals(
            request_context,
            app_id=app_model.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(WorkflowDailyTerminalsStatisticResponse, {"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/token-costs")
class WorkflowDailyTokenCostStatistic(Resource):
    @console_ns.doc("get_workflow_daily_token_cost_statistic")
    @console_ns.doc(description="Get workflow daily token cost statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowStatisticQuery))
    @console_ns.response(
        200,
        "Daily token cost statistics retrieved successfully",
        console_ns.models[WorkflowDailyTokenCostStatisticResponse.__name__],
    )
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @get_app_model
    @model_validate(WorkflowStatisticQuery)
    def get(self, req_data: WorkflowStatisticQuery, request_context: RequestContext, app_model: App):
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().workflow_statistics.get_daily_token_costs(
            request_context,
            app_id=app_model.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(WorkflowDailyTokenCostStatisticResponse, {"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/average-app-interactions")
class WorkflowAverageAppInteractionStatistic(Resource):
    @console_ns.doc("get_workflow_average_app_interaction_statistic")
    @console_ns.doc(description="Get workflow average app interaction statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowStatisticQuery))
    @console_ns.response(
        200,
        "Average app interaction statistics retrieved successfully",
        console_ns.models[WorkflowAverageAppInteractionStatisticResponse.__name__],
    )
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())],
    )
    @get_app_model(mode=[AppMode.WORKFLOW])
    @model_validate(WorkflowStatisticQuery)
    def get(self, req_data: WorkflowStatisticQuery, request_context: RequestContext, app_model: App):
        start_date, end_date, timezone = _resolve_statistic_time_range(req_data)
        response_data = application_services().workflow_statistics.get_average_app_interactions(
            request_context,
            app_id=app_model.id,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
        )

        return dump_response(WorkflowAverageAppInteractionStatisticResponse, {"data": response_data})
