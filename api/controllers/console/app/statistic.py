# -*- coding:utf-8 -*-
from datetime import datetime

import pytz
from flask import jsonify
from flask_login import login_required, current_user
from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.app import _get_app
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from libs.helper import datetime_string
from extensions.ext_database import db


class DailyConversationStatistic(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        account = current_user
        app_id = str(app_id)
        app_model = _get_app(app_id)

        parser = reqparse.RequestParser()
        parser.add_argument('start', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        parser.add_argument('end', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        args = parser.parse_args()

        sql_query = '''
        SELECT date(DATE_TRUNC('day', created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz )) AS date, count(distinct messages.conversation_id) AS conversation_count
            FROM messages where app_id = :app_id 
        '''
        arg_dict = {'tz': account.timezone, 'app_id': app_model.id}

        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        if args['start']:
            start_datetime = datetime.strptime(args['start'], '%Y-%m-%d %H:%M')
            start_datetime = start_datetime.replace(second=0)

            start_datetime_timezone = timezone.localize(start_datetime)
            start_datetime_utc = start_datetime_timezone.astimezone(utc_timezone)

            sql_query += ' and created_at >= :start'
            arg_dict['start'] = start_datetime_utc

        if args['end']:
            end_datetime = datetime.strptime(args['end'], '%Y-%m-%d %H:%M')
            end_datetime = end_datetime.replace(second=0)

            end_datetime_timezone = timezone.localize(end_datetime)
            end_datetime_utc = end_datetime_timezone.astimezone(utc_timezone)

            sql_query += ' and created_at < :end'
            arg_dict['end'] = end_datetime_utc

        sql_query += ' GROUP BY date order by date'
        rs = db.session.execute(sql_query, arg_dict)

        response_date = []

        for i in rs:
            response_date.append({
                'date': str(i.date),
                'conversation_count': i.conversation_count
            })

        return jsonify({
            'data': response_date
        })


class DailyTerminalsStatistic(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        account = current_user
        app_id = str(app_id)
        app_model = _get_app(app_id)

        parser = reqparse.RequestParser()
        parser.add_argument('start', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        parser.add_argument('end', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        args = parser.parse_args()

        sql_query = '''
                SELECT date(DATE_TRUNC('day', created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz )) AS date, count(distinct messages.from_end_user_id) AS terminal_count
                    FROM messages where app_id = :app_id 
                '''
        arg_dict = {'tz': account.timezone, 'app_id': app_model.id}

        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        if args['start']:
            start_datetime = datetime.strptime(args['start'], '%Y-%m-%d %H:%M')
            start_datetime = start_datetime.replace(second=0)

            start_datetime_timezone = timezone.localize(start_datetime)
            start_datetime_utc = start_datetime_timezone.astimezone(utc_timezone)

            sql_query += ' and created_at >= :start'
            arg_dict['start'] = start_datetime_utc

        if args['end']:
            end_datetime = datetime.strptime(args['end'], '%Y-%m-%d %H:%M')
            end_datetime = end_datetime.replace(second=0)

            end_datetime_timezone = timezone.localize(end_datetime)
            end_datetime_utc = end_datetime_timezone.astimezone(utc_timezone)

            sql_query += ' and created_at < :end'
            arg_dict['end'] = end_datetime_utc

        sql_query += ' GROUP BY date order by date'
        rs = db.session.execute(sql_query, arg_dict)

        response_date = []

        for i in rs:
            response_date.append({
                'date': str(i.date),
                'terminal_count': i.terminal_count
            })

        return jsonify({
            'data': response_date
        })


class DailyTokenCostStatistic(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        account = current_user
        app_id = str(app_id)
        app_model = _get_app(app_id)

        parser = reqparse.RequestParser()
        parser.add_argument('start', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        parser.add_argument('end', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        args = parser.parse_args()

        sql_query = '''
                SELECT date(DATE_TRUNC('day', created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz )) AS date, 
                    (sum(messages.message_tokens) + sum(messages.answer_tokens)) as token_count,
                    sum(total_price) as total_price
                    FROM messages where app_id = :app_id 
                '''
        arg_dict = {'tz': account.timezone, 'app_id': app_model.id}

        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        if args['start']:
            start_datetime = datetime.strptime(args['start'], '%Y-%m-%d %H:%M')
            start_datetime = start_datetime.replace(second=0)

            start_datetime_timezone = timezone.localize(start_datetime)
            start_datetime_utc = start_datetime_timezone.astimezone(utc_timezone)

            sql_query += ' and created_at >= :start'
            arg_dict['start'] = start_datetime_utc

        if args['end']:
            end_datetime = datetime.strptime(args['end'], '%Y-%m-%d %H:%M')
            end_datetime = end_datetime.replace(second=0)

            end_datetime_timezone = timezone.localize(end_datetime)
            end_datetime_utc = end_datetime_timezone.astimezone(utc_timezone)

            sql_query += ' and created_at < :end'
            arg_dict['end'] = end_datetime_utc

        sql_query += ' GROUP BY date order by date'
        rs = db.session.execute(sql_query, arg_dict)

        response_date = []

        for i in rs:
            response_date.append({
                'date': str(i.date),
                'token_count': i.token_count,
                'total_price': i.total_price,
                'currency': 'USD'
            })

        return jsonify({
            'data': response_date
        })


api.add_resource(DailyConversationStatistic, '/apps/<uuid:app_id>/statistics/daily-conversations')
api.add_resource(DailyTerminalsStatistic, '/apps/<uuid:app_id>/statistics/daily-end-users')
api.add_resource(DailyTokenCostStatistic, '/apps/<uuid:app_id>/statistics/token-costs')
