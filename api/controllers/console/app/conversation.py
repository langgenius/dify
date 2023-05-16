from datetime import datetime

import pytz
from flask_login import login_required, current_user
from flask_restful import Resource, reqparse, fields, marshal_with
from flask_restful.inputs import int_range
from sqlalchemy import or_, func
from sqlalchemy.orm import joinedload
from werkzeug.exceptions import NotFound

from controllers.console import api
from controllers.console.app import _get_app
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from libs.helper import TimestampField, datetime_string, uuid_value
from extensions.ext_database import db
from models.model import Message, MessageAnnotation, Conversation

account_fields = {
    'id': fields.String,
    'name': fields.String,
    'email': fields.String
}

feedback_fields = {
    'rating': fields.String,
    'content': fields.String,
    'from_source': fields.String,
    'from_end_user_id': fields.String,
    'from_account': fields.Nested(account_fields, allow_null=True),
}

annotation_fields = {
    'content': fields.String,
    'account': fields.Nested(account_fields, allow_null=True),
    'created_at': TimestampField
}

message_detail_fields = {
    'id': fields.String,
    'conversation_id': fields.String,
    'inputs': fields.Raw,
    'query': fields.String,
    'message': fields.Raw,
    'message_tokens': fields.Integer,
    'answer': fields.String,
    'answer_tokens': fields.Integer,
    'provider_response_latency': fields.Float,
    'from_source': fields.String,
    'from_end_user_id': fields.String,
    'from_account_id': fields.String,
    'feedbacks': fields.List(fields.Nested(feedback_fields)),
    'annotation': fields.Nested(annotation_fields, allow_null=True),
    'created_at': TimestampField
}

feedback_stat_fields = {
    'like': fields.Integer,
    'dislike': fields.Integer
}

model_config_fields = {
    'opening_statement': fields.String,
    'suggested_questions': fields.Raw,
    'model': fields.Raw,
    'user_input_form': fields.Raw,
    'pre_prompt': fields.String,
    'agent_mode': fields.Raw,
}


class CompletionConversationApi(Resource):
    class MessageTextField(fields.Raw):
        def format(self, value):
            return value[0]['text'] if value else ''

    simple_configs_fields = {
        'prompt_template': fields.String,
    }

    simple_model_config_fields = {
        'model': fields.Raw(attribute='model_dict'),
        'pre_prompt': fields.String,
    }

    simple_message_detail_fields = {
        'inputs': fields.Raw,
        'query': fields.String,
        'message': MessageTextField,
        'answer': fields.String,
    }

    conversation_fields = {
        'id': fields.String,
        'status': fields.String,
        'from_source': fields.String,
        'from_end_user_id': fields.String,
        'from_account_id': fields.String,
        'read_at': TimestampField,
        'created_at': TimestampField,
        'annotation': fields.Nested(annotation_fields, allow_null=True),
        'model_config': fields.Nested(simple_model_config_fields),
        'user_feedback_stats': fields.Nested(feedback_stat_fields),
        'admin_feedback_stats': fields.Nested(feedback_stat_fields),
        'message': fields.Nested(simple_message_detail_fields, attribute='first_message')
    }

    conversation_pagination_fields = {
        'page': fields.Integer,
        'limit': fields.Integer(attribute='per_page'),
        'total': fields.Integer,
        'has_more': fields.Boolean(attribute='has_next'),
        'data': fields.List(fields.Nested(conversation_fields), attribute='items')
    }

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(conversation_pagination_fields)
    def get(self, app_id):
        app_id = str(app_id)

        parser = reqparse.RequestParser()
        parser.add_argument('keyword', type=str, location='args')
        parser.add_argument('start', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        parser.add_argument('end', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        parser.add_argument('annotation_status', type=str,
                            choices=['annotated', 'not_annotated', 'all'], default='all', location='args')
        parser.add_argument('page', type=int_range(1, 99999), default=1, location='args')
        parser.add_argument('limit', type=int_range(1, 100), default=20, location='args')
        args = parser.parse_args()

        # get app info
        app = _get_app(app_id, 'completion')

        query = db.select(Conversation).where(Conversation.app_id == app.id, Conversation.mode == 'completion')

        if args['keyword']:
            query = query.join(
                Message, Message.conversation_id == Conversation.id
            ).filter(
                or_(
                    Message.query.ilike('%{}%'.format(args['keyword'])),
                    Message.answer.ilike('%{}%'.format(args['keyword']))
                )
            )

        account = current_user
        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        if args['start']:
            start_datetime = datetime.strptime(args['start'], '%Y-%m-%d %H:%M')
            start_datetime = start_datetime.replace(second=0)

            start_datetime_timezone = timezone.localize(start_datetime)
            start_datetime_utc = start_datetime_timezone.astimezone(utc_timezone)

            query = query.where(Conversation.created_at >= start_datetime_utc)

        if args['end']:
            end_datetime = datetime.strptime(args['end'], '%Y-%m-%d %H:%M')
            end_datetime = end_datetime.replace(second=0)

            end_datetime_timezone = timezone.localize(end_datetime)
            end_datetime_utc = end_datetime_timezone.astimezone(utc_timezone)

            query = query.where(Conversation.created_at < end_datetime_utc)

        if args['annotation_status'] == "annotated":
            query = query.options(joinedload(Conversation.message_annotations)).join(
                MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id
            )
        elif args['annotation_status'] == "not_annotated":
            query = query.outerjoin(
                MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id
            ).group_by(Conversation.id).having(func.count(MessageAnnotation.id) == 0)

        query = query.order_by(Conversation.created_at.desc())

        conversations = db.paginate(
            query,
            page=args['page'],
            per_page=args['limit'],
            error_out=False
        )

        return conversations


class CompletionConversationDetailApi(Resource):
    conversation_detail_fields = {
        'id': fields.String,
        'status': fields.String,
        'from_source': fields.String,
        'from_end_user_id': fields.String,
        'from_account_id': fields.String,
        'created_at': TimestampField,
        'model_config': fields.Nested(model_config_fields),
        'message': fields.Nested(message_detail_fields, attribute='first_message'),
    }

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(conversation_detail_fields)
    def get(self, app_id, conversation_id):
        app_id = str(app_id)
        conversation_id = str(conversation_id)

        return _get_conversation(app_id, conversation_id, 'completion')


class ChatConversationApi(Resource):
    simple_configs_fields = {
        'prompt_template': fields.String,
    }

    simple_model_config_fields = {
        'model': fields.Raw(attribute='model_dict'),
        'pre_prompt': fields.String,
    }

    conversation_fields = {
        'id': fields.String,
        'status': fields.String,
        'from_source': fields.String,
        'from_end_user_id': fields.String,
        'from_account_id': fields.String,
        'summary': fields.String(attribute='summary_or_query'),
        'read_at': TimestampField,
        'created_at': TimestampField,
        'annotated': fields.Boolean,
        'model_config': fields.Nested(simple_model_config_fields),
        'message_count': fields.Integer,
        'user_feedback_stats': fields.Nested(feedback_stat_fields),
        'admin_feedback_stats': fields.Nested(feedback_stat_fields)
    }

    conversation_pagination_fields = {
        'page': fields.Integer,
        'limit': fields.Integer(attribute='per_page'),
        'total': fields.Integer,
        'has_more': fields.Boolean(attribute='has_next'),
        'data': fields.List(fields.Nested(conversation_fields), attribute='items')
    }

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(conversation_pagination_fields)
    def get(self, app_id):
        app_id = str(app_id)

        parser = reqparse.RequestParser()
        parser.add_argument('keyword', type=str, location='args')
        parser.add_argument('start', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        parser.add_argument('end', type=datetime_string('%Y-%m-%d %H:%M'), location='args')
        parser.add_argument('annotation_status', type=str,
                            choices=['annotated', 'not_annotated', 'all'], default='all', location='args')
        parser.add_argument('message_count_gte', type=int_range(1, 99999), required=False, location='args')
        parser.add_argument('page', type=int_range(1, 99999), required=False, default=1, location='args')
        parser.add_argument('limit', type=int_range(1, 100), required=False, default=20, location='args')
        args = parser.parse_args()

        # get app info
        app = _get_app(app_id, 'chat')

        query = db.select(Conversation).where(Conversation.app_id == app.id, Conversation.mode == 'chat')

        if args['keyword']:
            query = query.join(
                Message, Message.conversation_id == Conversation.id
            ).filter(
                or_(
                    Message.query.ilike('%{}%'.format(args['keyword'])),
                    Message.answer.ilike('%{}%'.format(args['keyword'])),
                    Conversation.name.ilike('%{}%'.format(args['keyword'])),
                    Conversation.introduction.ilike('%{}%'.format(args['keyword'])),
                ),

            )

        account = current_user
        timezone = pytz.timezone(account.timezone)
        utc_timezone = pytz.utc

        if args['start']:
            start_datetime = datetime.strptime(args['start'], '%Y-%m-%d %H:%M')
            start_datetime = start_datetime.replace(second=0)

            start_datetime_timezone = timezone.localize(start_datetime)
            start_datetime_utc = start_datetime_timezone.astimezone(utc_timezone)

            query = query.where(Conversation.created_at >= start_datetime_utc)

        if args['end']:
            end_datetime = datetime.strptime(args['end'], '%Y-%m-%d %H:%M')
            end_datetime = end_datetime.replace(second=0)

            end_datetime_timezone = timezone.localize(end_datetime)
            end_datetime_utc = end_datetime_timezone.astimezone(utc_timezone)

            query = query.where(Conversation.created_at < end_datetime_utc)

        if args['annotation_status'] == "annotated":
            query = query.options(joinedload(Conversation.message_annotations)).join(
                MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id
            )
        elif args['annotation_status'] == "not_annotated":
            query = query.outerjoin(
                MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id
            ).group_by(Conversation.id).having(func.count(MessageAnnotation.id) == 0)

        if args['message_count_gte'] and args['message_count_gte'] >= 1:
            query = (
                query.options(joinedload(Conversation.messages))
                .join(Message, Message.conversation_id == Conversation.id)
                .group_by(Conversation.id)
                .having(func.count(Message.id) >= args['message_count_gte'])
            )

        query = query.order_by(Conversation.created_at.desc())

        conversations = db.paginate(
            query,
            page=args['page'],
            per_page=args['limit'],
            error_out=False
        )

        return conversations


class ChatConversationDetailApi(Resource):
    conversation_detail_fields = {
        'id': fields.String,
        'status': fields.String,
        'from_source': fields.String,
        'from_end_user_id': fields.String,
        'from_account_id': fields.String,
        'created_at': TimestampField,
        'annotated': fields.Boolean,
        'model_config': fields.Nested(model_config_fields),
        'message_count': fields.Integer,
        'user_feedback_stats': fields.Nested(feedback_stat_fields),
        'admin_feedback_stats': fields.Nested(feedback_stat_fields)
    }

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(conversation_detail_fields)
    def get(self, app_id, conversation_id):
        app_id = str(app_id)
        conversation_id = str(conversation_id)

        return _get_conversation(app_id, conversation_id, 'chat')




api.add_resource(CompletionConversationApi, '/apps/<uuid:app_id>/completion-conversations')
api.add_resource(CompletionConversationDetailApi, '/apps/<uuid:app_id>/completion-conversations/<uuid:conversation_id>')
api.add_resource(ChatConversationApi, '/apps/<uuid:app_id>/chat-conversations')
api.add_resource(ChatConversationDetailApi, '/apps/<uuid:app_id>/chat-conversations/<uuid:conversation_id>')


def _get_conversation(app_id, conversation_id, mode):
    # get app info
    app = _get_app(app_id, mode)

    conversation = db.session.query(Conversation) \
        .filter(Conversation.id == conversation_id, Conversation.app_id == app.id).first()

    if not conversation:
        raise NotFound("Conversation Not Exists.")

    if not conversation.read_at:
        conversation.read_at = datetime.utcnow()
        conversation.read_account_id = current_user.id
        db.session.commit()

    return conversation
