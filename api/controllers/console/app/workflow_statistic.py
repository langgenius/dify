from datetime import datetime

import pytz
from flask import jsonify
from flask_restx import Resource, reqparse
from sqlalchemy.orm import sessionmaker

from controllers.console import api, console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from libs.helper import DatetimeString
from libs.login import current_account_with_tenant, login_required
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode
from repositories.factory import DifyAPIRepositoryFactory


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/daily-conversations")
class WorkflowDailyRunsStatistic(Resource):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    @api.doc("get_workflow_daily_runs_statistic")
    @api.doc(description="Get workflow daily runs statistics")
    @api.doc(params={"app_id": "Application ID"})
    @api.doc(params={"start": "Start date and time (YYYY-MM-DD HH:MM)", "end": "End date and time (YYYY-MM-DD HH:MM)"})
    @api.response(200, "Daily runs statistics retrieved successfully")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_model):
        account, _ = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("start", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
            .add_argument("end", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        )
        args = parser.parse_args()

        assert account.timezone is not None
        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        start_date = None
        end_date = None

        if args["start"]:
            start_datetime = datetime.strptime(args["start"], "%Y-%m-%d %H:%M")
            start_datetime = start_datetime.replace(second=0)
            start_datetime_timezone = timezone.localize(start_datetime)
            start_date = start_datetime_timezone.astimezone(utc_timezone)

        if args["end"]:
            end_datetime = datetime.strptime(args["end"], "%Y-%m-%d %H:%M")
            end_datetime = end_datetime.replace(second=0)
            end_datetime_timezone = timezone.localize(end_datetime)
            end_date = end_datetime_timezone.astimezone(utc_timezone)

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

    @api.doc("get_workflow_daily_terminals_statistic")
    @api.doc(description="Get workflow daily terminals statistics")
    @api.doc(params={"app_id": "Application ID"})
    @api.doc(params={"start": "Start date and time (YYYY-MM-DD HH:MM)", "end": "End date and time (YYYY-MM-DD HH:MM)"})
    @api.response(200, "Daily terminals statistics retrieved successfully")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_model):
        account, _ = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("start", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
            .add_argument("end", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        )
        args = parser.parse_args()

        assert account.timezone is not None
        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        start_date = None
        end_date = None

        if args["start"]:
            start_datetime = datetime.strptime(args["start"], "%Y-%m-%d %H:%M")
            start_datetime = start_datetime.replace(second=0)
            start_datetime_timezone = timezone.localize(start_datetime)
            start_date = start_datetime_timezone.astimezone(utc_timezone)

        if args["end"]:
            end_datetime = datetime.strptime(args["end"], "%Y-%m-%d %H:%M")
            end_datetime = end_datetime.replace(second=0)
            end_datetime_timezone = timezone.localize(end_datetime)
            end_date = end_datetime_timezone.astimezone(utc_timezone)

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

    @api.doc("get_workflow_daily_token_cost_statistic")
    @api.doc(description="Get workflow daily token cost statistics")
    @api.doc(params={"app_id": "Application ID"})
    @api.doc(params={"start": "Start date and time (YYYY-MM-DD HH:MM)", "end": "End date and time (YYYY-MM-DD HH:MM)"})
    @api.response(200, "Daily token cost statistics retrieved successfully")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_model):
        account, _ = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("start", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
            .add_argument("end", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        )
        args = parser.parse_args()

        assert account.timezone is not None
        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        start_date = None
        end_date = None

        if args["start"]:
            start_datetime = datetime.strptime(args["start"], "%Y-%m-%d %H:%M")
            start_datetime = start_datetime.replace(second=0)
            start_datetime_timezone = timezone.localize(start_datetime)
            start_date = start_datetime_timezone.astimezone(utc_timezone)

        if args["end"]:
            end_datetime = datetime.strptime(args["end"], "%Y-%m-%d %H:%M")
            end_datetime = end_datetime.replace(second=0)
            end_datetime_timezone = timezone.localize(end_datetime)
            end_date = end_datetime_timezone.astimezone(utc_timezone)

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

    @api.doc("get_workflow_average_app_interaction_statistic")
    @api.doc(description="Get workflow average app interaction statistics")
    @api.doc(params={"app_id": "Application ID"})
    @api.doc(params={"start": "Start date and time (YYYY-MM-DD HH:MM)", "end": "End date and time (YYYY-MM-DD HH:MM)"})
    @api.response(200, "Average app interaction statistics retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    def get(self, app_model):
        account, _ = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("start", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
            .add_argument("end", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        )
        args = parser.parse_args()

        assert account.timezone is not None
        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        start_date = None
        end_date = None

        if args["start"]:
            start_datetime = datetime.strptime(args["start"], "%Y-%m-%d %H:%M")
            start_datetime = start_datetime.replace(second=0)
            start_datetime_timezone = timezone.localize(start_datetime)
            start_date = start_datetime_timezone.astimezone(utc_timezone)

        if args["end"]:
            end_datetime = datetime.strptime(args["end"], "%Y-%m-%d %H:%M")
            end_datetime = end_datetime.replace(second=0)
            end_datetime_timezone = timezone.localize(end_datetime)
            end_date = end_datetime_timezone.astimezone(utc_timezone)

        response_data = self._workflow_run_repo.get_average_app_interaction_statistics(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            start_date=start_date,
            end_date=end_date,
            timezone=account.timezone,
        )

        return jsonify({"data": response_data})
