from datetime import datetime
from decimal import Decimal

import pytz
from flask import jsonify
from flask_login import current_user
from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from extensions.ext_database import db
from libs.helper import datetime_string
from libs.login import login_required
from models.model import AppMode


class DailyConversationStatistic(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model):
        account = current_user

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

        response_data = []

        with db.engine.begin() as conn:
            rs = conn.execute(db.text(sql_query), arg_dict)
            for i in rs:
                response_data.append({
                    'date': str(i.date),
                    'conversation_count': i.conversation_count
                })

        return jsonify({
            'data': response_data
        })


class DailyTerminalsStatistic(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model):
        account = current_user

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

        response_data = []

        with db.engine.begin() as conn:
            rs = conn.execute(db.text(sql_query), arg_dict)            
            for i in rs:
                response_data.append({
                    'date': str(i.date),
                    'terminal_count': i.terminal_count
                })

        return jsonify({
            'data': response_data
        })


class DailyTokenCostStatistic(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model):
        account = current_user

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

        response_data = []

        with db.engine.begin() as conn:
            rs = conn.execute(db.text(sql_query), arg_dict)
            for i in rs:
                response_data.append({
                    'date': str(i.date),
                    'token_count': i.token_count,
                    'total_price': i.total_price,
                    'currency': 'USD'
                })

        return jsonify({
            'data': response_data
        })


class AverageSessionInteractionStatistic(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    def get(self, app_model):
        account = current_user

        parser = reqparse.RequestParser()
        parser.add_argument('start', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        parser.add_argument('end', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        args = parser.parse_args()

        sql_query = """SELECT date(DATE_TRUNC('day', c.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz )) AS date, 
AVG(subquery.message_count) AS interactions
FROM (SELECT m.conversation_id, COUNT(m.id) AS message_count
    FROM conversations c
    JOIN messages m ON c.id = m.conversation_id
    WHERE c.override_model_configs IS NULL AND c.app_id = :app_id"""
        arg_dict = {'tz': account.timezone, 'app_id': app_model.id}

        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        if args['start']:
            start_datetime = datetime.strptime(args['start'], '%Y-%m-%d %H:%M')
            start_datetime = start_datetime.replace(second=0)

            start_datetime_timezone = timezone.localize(start_datetime)
            start_datetime_utc = start_datetime_timezone.astimezone(utc_timezone)

            sql_query += ' and c.created_at >= :start'
            arg_dict['start'] = start_datetime_utc

        if args['end']:
            end_datetime = datetime.strptime(args['end'], '%Y-%m-%d %H:%M')
            end_datetime = end_datetime.replace(second=0)

            end_datetime_timezone = timezone.localize(end_datetime)
            end_datetime_utc = end_datetime_timezone.astimezone(utc_timezone)

            sql_query += ' and c.created_at < :end'
            arg_dict['end'] = end_datetime_utc

        sql_query += """
        GROUP BY m.conversation_id) subquery
LEFT JOIN conversations c on c.id=subquery.conversation_id
GROUP BY date
ORDER BY date"""

        response_data = []
        
        with db.engine.begin() as conn:
            rs = conn.execute(db.text(sql_query), arg_dict)
            for i in rs:
                response_data.append({
                    'date': str(i.date),
                    'interactions': float(i.interactions.quantize(Decimal('0.01')))
                })

        return jsonify({
            'data': response_data
        })


class UserSatisfactionRateStatistic(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model):
        account = current_user

        parser = reqparse.RequestParser()
        parser.add_argument('start', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        parser.add_argument('end', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        args = parser.parse_args()

        sql_query = '''
                        SELECT date(DATE_TRUNC('day', m.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz )) AS date, 
                            COUNT(m.id) as message_count, COUNT(mf.id) as feedback_count 
                            FROM messages m
                            LEFT JOIN message_feedbacks mf on mf.message_id=m.id and mf.rating='like'
                            WHERE m.app_id = :app_id 
                        '''
        arg_dict = {'tz': account.timezone, 'app_id': app_model.id}

        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        if args['start']:
            start_datetime = datetime.strptime(args['start'], '%Y-%m-%d %H:%M')
            start_datetime = start_datetime.replace(second=0)

            start_datetime_timezone = timezone.localize(start_datetime)
            start_datetime_utc = start_datetime_timezone.astimezone(utc_timezone)

            sql_query += ' and m.created_at >= :start'
            arg_dict['start'] = start_datetime_utc

        if args['end']:
            end_datetime = datetime.strptime(args['end'], '%Y-%m-%d %H:%M')
            end_datetime = end_datetime.replace(second=0)

            end_datetime_timezone = timezone.localize(end_datetime)
            end_datetime_utc = end_datetime_timezone.astimezone(utc_timezone)

            sql_query += ' and m.created_at < :end'
            arg_dict['end'] = end_datetime_utc

        sql_query += ' GROUP BY date order by date'

        response_data = []

        with db.engine.begin() as conn:
            rs = conn.execute(db.text(sql_query), arg_dict)
            for i in rs:
                response_data.append({
                    'date': str(i.date),
                    'rate': round((i.feedback_count * 1000 / i.message_count) if i.message_count > 0 else 0, 2),
                })

        return jsonify({
            'data': response_data
        })


class AverageResponseTimeStatistic(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.COMPLETION)
    def get(self, app_model):
        account = current_user

        parser = reqparse.RequestParser()
        parser.add_argument('start', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        parser.add_argument('end', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        args = parser.parse_args()

        sql_query = '''
                SELECT date(DATE_TRUNC('day', created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz )) AS date, 
                    AVG(provider_response_latency) as latency
                    FROM messages
                    WHERE app_id = :app_id
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

        response_data = []

        with db.engine.begin() as conn:
            rs = conn.execute(db.text(sql_query), arg_dict)            
            for i in rs:
                response_data.append({
                    'date': str(i.date),
                    'latency': round(i.latency * 1000, 4)
                })

        return jsonify({
            'data': response_data
        })


class TokensPerSecondStatistic(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model):
        account = current_user

        parser = reqparse.RequestParser()
        parser.add_argument('start', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        parser.add_argument('end', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        args = parser.parse_args()

        sql_query = '''SELECT date(DATE_TRUNC('day', created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz )) AS date, 
    CASE 
        WHEN SUM(provider_response_latency) = 0 THEN 0
        ELSE (SUM(answer_tokens) / SUM(provider_response_latency))
    END as tokens_per_second
FROM messages
WHERE app_id = :app_id'''
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

        response_data = []

        with db.engine.begin() as conn:
            rs = conn.execute(db.text(sql_query), arg_dict)
            for i in rs:
                response_data.append({
                    'date': str(i.date),
                    'tps': round(i.tokens_per_second, 4)
                })

        return jsonify({
            'data': response_data
        })


api.add_resource(DailyConversationStatistic, '/apps/<uuid:app_id>/statistics/daily-conversations')
api.add_resource(DailyTerminalsStatistic, '/apps/<uuid:app_id>/statistics/daily-end-users')
api.add_resource(DailyTokenCostStatistic, '/apps/<uuid:app_id>/statistics/token-costs')
api.add_resource(AverageSessionInteractionStatistic, '/apps/<uuid:app_id>/statistics/average-session-interactions')
api.add_resource(UserSatisfactionRateStatistic, '/apps/<uuid:app_id>/statistics/user-satisfaction-rate')
api.add_resource(AverageResponseTimeStatistic, '/apps/<uuid:app_id>/statistics/average-response-time')
api.add_resource(TokensPerSecondStatistic, '/apps/<uuid:app_id>/statistics/tokens-per-second')
