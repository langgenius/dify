from datetime import datetime
from decimal import Decimal

import pytz
import sqlalchemy as sa
from flask import jsonify
from flask_login import current_user
from flask_restx import Resource, reqparse

from controllers.console import api, console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from libs.helper import DatetimeString
from libs.login import login_required
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/daily-conversations")
class WorkflowDailyRunsStatistic(Resource):
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
        account = current_user

        parser = reqparse.RequestParser()
        parser.add_argument("start", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        parser.add_argument("end", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        args = parser.parse_args()

        sql_query = """SELECT
    DATE(DATE_TRUNC('day', created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz )) AS date,
    COUNT(id) AS runs
FROM
    workflow_runs
WHERE
    app_id = :app_id
    AND triggered_from = :triggered_from"""
        arg_dict = {
            "tz": account.timezone,
            "app_id": app_model.id,
            "triggered_from": WorkflowRunTriggeredFrom.APP_RUN.value,
        }

        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        if args["start"]:
            start_datetime = datetime.strptime(args["start"], "%Y-%m-%d %H:%M")
            start_datetime = start_datetime.replace(second=0)

            start_datetime_timezone = timezone.localize(start_datetime)
            start_datetime_utc = start_datetime_timezone.astimezone(utc_timezone)

            sql_query += " AND created_at >= :start"
            arg_dict["start"] = start_datetime_utc

        if args["end"]:
            end_datetime = datetime.strptime(args["end"], "%Y-%m-%d %H:%M")
            end_datetime = end_datetime.replace(second=0)

            end_datetime_timezone = timezone.localize(end_datetime)
            end_datetime_utc = end_datetime_timezone.astimezone(utc_timezone)

            sql_query += " AND created_at < :end"
            arg_dict["end"] = end_datetime_utc

        sql_query += " GROUP BY date ORDER BY date"

        response_data = []

        with db.engine.begin() as conn:
            rs = conn.execute(sa.text(sql_query), arg_dict)
            for i in rs:
                response_data.append({"date": str(i.date), "runs": i.runs})

        return jsonify({"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/daily-terminals")
class WorkflowDailyTerminalsStatistic(Resource):
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
        account = current_user

        parser = reqparse.RequestParser()
        parser.add_argument("start", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        parser.add_argument("end", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        args = parser.parse_args()

        sql_query = """SELECT
    DATE(DATE_TRUNC('day', created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz )) AS date,
    COUNT(DISTINCT workflow_runs.created_by) AS terminal_count
FROM
    workflow_runs
WHERE
    app_id = :app_id
    AND triggered_from = :triggered_from"""
        arg_dict = {
            "tz": account.timezone,
            "app_id": app_model.id,
            "triggered_from": WorkflowRunTriggeredFrom.APP_RUN.value,
        }

        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        if args["start"]:
            start_datetime = datetime.strptime(args["start"], "%Y-%m-%d %H:%M")
            start_datetime = start_datetime.replace(second=0)

            start_datetime_timezone = timezone.localize(start_datetime)
            start_datetime_utc = start_datetime_timezone.astimezone(utc_timezone)

            sql_query += " AND created_at >= :start"
            arg_dict["start"] = start_datetime_utc

        if args["end"]:
            end_datetime = datetime.strptime(args["end"], "%Y-%m-%d %H:%M")
            end_datetime = end_datetime.replace(second=0)

            end_datetime_timezone = timezone.localize(end_datetime)
            end_datetime_utc = end_datetime_timezone.astimezone(utc_timezone)

            sql_query += " AND created_at < :end"
            arg_dict["end"] = end_datetime_utc

        sql_query += " GROUP BY date ORDER BY date"

        response_data = []

        with db.engine.begin() as conn:
            rs = conn.execute(sa.text(sql_query), arg_dict)
            for i in rs:
                response_data.append({"date": str(i.date), "terminal_count": i.terminal_count})

        return jsonify({"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/token-costs")
class WorkflowDailyTokenCostStatistic(Resource):
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
        account = current_user

        parser = reqparse.RequestParser()
        parser.add_argument("start", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        parser.add_argument("end", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        args = parser.parse_args()

        sql_query = """SELECT
    DATE(DATE_TRUNC('day', created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz )) AS date,
    SUM(workflow_runs.total_tokens) AS token_count
FROM
    workflow_runs
WHERE
    app_id = :app_id
    AND triggered_from = :triggered_from"""
        arg_dict = {
            "tz": account.timezone,
            "app_id": app_model.id,
            "triggered_from": WorkflowRunTriggeredFrom.APP_RUN.value,
        }

        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        if args["start"]:
            start_datetime = datetime.strptime(args["start"], "%Y-%m-%d %H:%M")
            start_datetime = start_datetime.replace(second=0)

            start_datetime_timezone = timezone.localize(start_datetime)
            start_datetime_utc = start_datetime_timezone.astimezone(utc_timezone)

            sql_query += " AND created_at >= :start"
            arg_dict["start"] = start_datetime_utc

        if args["end"]:
            end_datetime = datetime.strptime(args["end"], "%Y-%m-%d %H:%M")
            end_datetime = end_datetime.replace(second=0)

            end_datetime_timezone = timezone.localize(end_datetime)
            end_datetime_utc = end_datetime_timezone.astimezone(utc_timezone)

            sql_query += " AND created_at < :end"
            arg_dict["end"] = end_datetime_utc

        sql_query += " GROUP BY date ORDER BY date"

        response_data = []

        with db.engine.begin() as conn:
            rs = conn.execute(sa.text(sql_query), arg_dict)
            for i in rs:
                response_data.append(
                    {
                        "date": str(i.date),
                        "token_count": i.token_count,
                    }
                )

        return jsonify({"data": response_data})


@console_ns.route("/apps/<uuid:app_id>/workflow/statistics/average-app-interactions")
class WorkflowAverageAppInteractionStatistic(Resource):
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
        account = current_user

        parser = reqparse.RequestParser()
        parser.add_argument("start", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        parser.add_argument("end", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
        args = parser.parse_args()

        sql_query = """SELECT
    AVG(sub.interactions) AS interactions,
    sub.date
FROM
    (
        SELECT
            DATE(DATE_TRUNC('day', c.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz )) AS date,
            c.created_by,
            COUNT(c.id) AS interactions
        FROM
            workflow_runs c
        WHERE
            c.app_id = :app_id
            AND c.triggered_from = :triggered_from
            {{start}}
            {{end}}
        GROUP BY
            date, c.created_by
    ) sub
GROUP BY
    sub.date"""
        arg_dict = {
            "tz": account.timezone,
            "app_id": app_model.id,
            "triggered_from": WorkflowRunTriggeredFrom.APP_RUN.value,
        }

        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        if args["start"]:
            start_datetime = datetime.strptime(args["start"], "%Y-%m-%d %H:%M")
            start_datetime = start_datetime.replace(second=0)

            start_datetime_timezone = timezone.localize(start_datetime)
            start_datetime_utc = start_datetime_timezone.astimezone(utc_timezone)

            sql_query = sql_query.replace("{{start}}", " AND c.created_at >= :start")
            arg_dict["start"] = start_datetime_utc
        else:
            sql_query = sql_query.replace("{{start}}", "")

        if args["end"]:
            end_datetime = datetime.strptime(args["end"], "%Y-%m-%d %H:%M")
            end_datetime = end_datetime.replace(second=0)

            end_datetime_timezone = timezone.localize(end_datetime)
            end_datetime_utc = end_datetime_timezone.astimezone(utc_timezone)

            sql_query = sql_query.replace("{{end}}", " AND c.created_at < :end")
            arg_dict["end"] = end_datetime_utc
        else:
            sql_query = sql_query.replace("{{end}}", "")

        response_data = []

        with db.engine.begin() as conn:
            rs = conn.execute(sa.text(sql_query), arg_dict)
            for i in rs:
                response_data.append(
                    {"date": str(i.date), "interactions": float(i.interactions.quantize(Decimal("0.01")))}
                )

        return jsonify({"data": response_data})
