from flask import abort, jsonify, request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import sessionmaker

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required, with_current_user
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.datetime_utils import parse_time_range
from libs.login import login_required
from models.account import Account
from models.enums import WorkflowRunTriggeredFrom
from models.model import App, AppMode
from repositories.factory import DifyAPIRepositoryFactory


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


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/daily-conversations")
class WorkflowDailyRunsStatistic(Resource):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    @console_ns.doc("get_workflow_daily_runs_statistic")
    @console_ns.doc(description="Get workflow daily runs statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowStatisticQuery))
    @console_ns.response(
        200,
        "Daily runs statistics retrieved successfully",
        console_ns.models[WorkflowDailyRunsStatisticResponse.__name__],
    )
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def get(self, account: Account, app_model: App):
        args = WorkflowStatisticQuery.model_validate(request.args.to_dict(flat=True))

        assert account.timezone is not None

        try:
            start_date, end_date = parse_time_range(args.start, args.end, account.timezone)
        except ValueError as e:
            abort(400, description=str(e))

        response_data = self._workflow_run_repo.get_daily_runs_statistics(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            start_date=start_date,
            end_date=end_date,
            timezone=account.timezone,
        )

        return jsonify({"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/daily-terminals")
class WorkflowDailyTerminalsStatistic(Resource):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    @console_ns.doc("get_workflow_daily_terminals_statistic")
    @console_ns.doc(description="Get workflow daily terminals statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowStatisticQuery))
    @console_ns.response(
        200,
        "Daily terminals statistics retrieved successfully",
        console_ns.models[WorkflowDailyTerminalsStatisticResponse.__name__],
    )
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def get(self, account: Account, app_model: App):
        args = WorkflowStatisticQuery.model_validate(request.args.to_dict(flat=True))

        assert account.timezone is not None

        try:
            start_date, end_date = parse_time_range(args.start, args.end, account.timezone)
        except ValueError as e:
            abort(400, description=str(e))

        response_data = self._workflow_run_repo.get_daily_terminals_statistics(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            start_date=start_date,
            end_date=end_date,
            timezone=account.timezone,
        )

        return jsonify({"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/token-costs")
class WorkflowDailyTokenCostStatistic(Resource):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    @console_ns.doc("get_workflow_daily_token_cost_statistic")
    @console_ns.doc(description="Get workflow daily token cost statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowStatisticQuery))
    @console_ns.response(
        200,
        "Daily token cost statistics retrieved successfully",
        console_ns.models[WorkflowDailyTokenCostStatisticResponse.__name__],
    )
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def get(self, account: Account, app_model: App):
        args = WorkflowStatisticQuery.model_validate(request.args.to_dict(flat=True))

        assert account.timezone is not None

        try:
            start_date, end_date = parse_time_range(args.start, args.end, account.timezone)
        except ValueError as e:
            abort(400, description=str(e))

        response_data = self._workflow_run_repo.get_daily_token_cost_statistics(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            start_date=start_date,
            end_date=end_date,
            timezone=account.timezone,
        )

        return jsonify({"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/average-app-interactions")
class WorkflowAverageAppInteractionStatistic(Resource):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    @console_ns.doc("get_workflow_average_app_interaction_statistic")
    @console_ns.doc(description="Get workflow average app interaction statistics")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(WorkflowStatisticQuery))
    @console_ns.response(
        200,
        "Average app interaction statistics retrieved successfully",
        console_ns.models[WorkflowAverageAppInteractionStatisticResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @with_current_user
    def get(self, account: Account, app_model: App):
        args = WorkflowStatisticQuery.model_validate(request.args.to_dict(flat=True))

        assert account.timezone is not None

        try:
            start_date, end_date = parse_time_range(args.start, args.end, account.timezone)
        except ValueError as e:
            abort(400, description=str(e))

        response_data = self._workflow_run_repo.get_average_app_interaction_statistics(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            start_date=start_date,
            end_date=end_date,
            timezone=account.timezone,
        )

        return jsonify({"data": response_data})
