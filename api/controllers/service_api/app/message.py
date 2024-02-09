from flask_restful import fields, marshal_with, reqparse
from flask_restful.inputs import int_range
from werkzeug.exceptions import NotFound

import services
from controllers.service_api import api
from controllers.service_api.app import create_or_update_end_user_for_user_id
from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.wraps import AppApiResource
from extensions.ext_database import db
from fields.conversation_fields import message_file_fields
from libs.helper import TimestampField, uuid_value
from models.model import EndUser, Message
from services.message_service import MessageService


class MessageListApi(AppApiResource):
    feedback_fields = {
        'rating': fields.String
    }
    retriever_resource_fields = {
        'id': fields.String,
        'message_id': fields.String,
        'position': fields.Integer,
        'dataset_id': fields.String,
        'dataset_name': fields.String,
        'document_id': fields.String,
        'document_name': fields.String,
        'data_source_type': fields.String,
        'segment_id': fields.String,
        'score': fields.Float,
        'hit_count': fields.Integer,
        'word_count': fields.Integer,
        'segment_position': fields.Integer,
        'index_node_hash': fields.String,
        'content': fields.String,
        'created_at': TimestampField
    }

    agent_thought_fields = {
        'id': fields.String,
        'chain_id': fields.String,
        'message_id': fields.String,
        'position': fields.Integer,
        'thought': fields.String,
        'tool': fields.String,
        'tool_labels': fields.Raw,
        'tool_input': fields.String,
        'created_at': TimestampField,
        'observation': fields.String,
        'message_files': fields.List(fields.String, attribute='files')
    }

    message_fields = {
        'id': fields.String,
        'conversation_id': fields.String,
        'inputs': fields.Raw,
        'query': fields.String,
        'answer': fields.String,
        'message_files': fields.List(fields.Nested(message_file_fields), attribute='files'),
        'feedback': fields.Nested(feedback_fields, attribute='user_feedback', allow_null=True),
        'retriever_resources': fields.List(fields.Nested(retriever_resource_fields)),
        'created_at': TimestampField,
        'agent_thoughts': fields.List(fields.Nested(agent_thought_fields))
    }

    message_infinite_scroll_pagination_fields = {
        'limit': fields.Integer,
        'has_more': fields.Boolean,
        'data': fields.List(fields.Nested(message_fields))
    }

    @marshal_with(message_infinite_scroll_pagination_fields)
    def get(self, app_model, end_user):
        if app_model.mode != 'chat':
            raise NotChatAppError()

        parser = reqparse.RequestParser()
        parser.add_argument('conversation_id', required=True, type=uuid_value, location='args')
        parser.add_argument('first_id', type=uuid_value, location='args')
        parser.add_argument('limit', type=int_range(1, 100), required=False, default=20, location='args')
        parser.add_argument('user', type=str, location='args')
        args = parser.parse_args()

        if end_user is None and args['user'] is not None:
            end_user = create_or_update_end_user_for_user_id(app_model, args['user'])

        try:
            return MessageService.pagination_by_first_id(app_model, end_user,
                                                         args['conversation_id'], args['first_id'], args['limit'])
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.message.FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


class MessageFeedbackApi(AppApiResource):
    def post(self, app_model, end_user, message_id):
        message_id = str(message_id)

        parser = reqparse.RequestParser()
        parser.add_argument('rating', type=str, choices=['like', 'dislike', None], location='json')
        parser.add_argument('user', type=str, location='json')
        args = parser.parse_args()

        if end_user is None and args['user'] is not None:
            end_user = create_or_update_end_user_for_user_id(app_model, args['user'])

        try:
            MessageService.create_feedback(app_model, message_id, end_user, args['rating'])
        except services.errors.message.MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {'result': 'success'}


class MessageSuggestedApi(AppApiResource):
    def get(self, app_model, end_user, message_id):
        message_id = str(message_id)
        if app_model.mode != 'chat':
            raise NotChatAppError()
        try:
            message = db.session.query(Message).filter(
                Message.id == message_id,
                Message.app_id == app_model.id,
            ).first()

            if end_user is None and message.from_end_user_id is not None:
                user = db.session.query(EndUser) \
                    .filter(
                        EndUser.tenant_id == app_model.tenant_id,
                        EndUser.id == message.from_end_user_id,
                        EndUser.type == 'service_api'
                    ).first()
            else:
                user = end_user
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model,
                user=user,
                message_id=message_id,
                check_enabled=False
            )
        except services.errors.message.MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {'result': 'success', 'data': questions}


api.add_resource(MessageListApi, '/messages')
api.add_resource(MessageFeedbackApi, '/messages/<uuid:message_id>/feedbacks')
api.add_resource(MessageSuggestedApi, '/messages/<uuid:message_id>/suggested')
