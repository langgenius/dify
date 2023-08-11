# -*- coding:utf-8 -*-
import logging

from flask_login import current_user
from flask_restful import reqparse, fields, marshal_with
from flask_restful.inputs import int_range
from werkzeug.exceptions import NotFound, InternalServerError

import services
from controllers.console import api
from controllers.console.app.error import ProviderNotInitializeError, \
    ProviderQuotaExceededError, ProviderModelCurrentlyNotSupportError, CompletionRequestError
from controllers.console.explore.error import AppSuggestedQuestionsAfterAnswerDisabledError
from controllers.console.universal_chat.wraps import UniversalChatResource
from core.model_providers.error import LLMRateLimitError, LLMBadRequestError, LLMAuthorizationError, LLMAPIConnectionError, \
    ProviderTokenNotInitError, LLMAPIUnavailableError, QuotaExceededError, ModelCurrentlyNotSupportError
from libs.helper import uuid_value, TimestampField
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_service import MessageService


class UniversalChatMessageListApi(UniversalChatResource):
    feedback_fields = {
        'rating': fields.String
    }

    agent_thought_fields = {
        'id': fields.String,
        'chain_id': fields.String,
        'message_id': fields.String,
        'position': fields.Integer,
        'thought': fields.String,
        'tool': fields.String,
        'tool_input': fields.String,
        'created_at': TimestampField
    }

    message_fields = {
        'id': fields.String,
        'conversation_id': fields.String,
        'inputs': fields.Raw,
        'query': fields.String,
        'answer': fields.String,
        'feedback': fields.Nested(feedback_fields, attribute='user_feedback', allow_null=True),
        'created_at': TimestampField,
        'agent_thoughts': fields.List(fields.Nested(agent_thought_fields))
    }

    message_infinite_scroll_pagination_fields = {
        'limit': fields.Integer,
        'has_more': fields.Boolean,
        'data': fields.List(fields.Nested(message_fields))
    }

    @marshal_with(message_infinite_scroll_pagination_fields)
    def get(self, universal_app):
        app_model = universal_app

        parser = reqparse.RequestParser()
        parser.add_argument('conversation_id', required=True, type=uuid_value, location='args')
        parser.add_argument('first_id', type=uuid_value, location='args')
        parser.add_argument('limit', type=int_range(1, 100), required=False, default=20, location='args')
        args = parser.parse_args()

        try:
            return MessageService.pagination_by_first_id(app_model, current_user,
                                                     args['conversation_id'], args['first_id'], args['limit'])
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.message.FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


class UniversalChatMessageFeedbackApi(UniversalChatResource):
    def post(self, universal_app, message_id):
        app_model = universal_app
        message_id = str(message_id)

        parser = reqparse.RequestParser()
        parser.add_argument('rating', type=str, choices=['like', 'dislike', None], location='json')
        args = parser.parse_args()

        try:
            MessageService.create_feedback(app_model, message_id, current_user, args['rating'])
        except services.errors.message.MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {'result': 'success'}


class UniversalChatMessageSuggestedQuestionApi(UniversalChatResource):
    def get(self, universal_app, message_id):
        app_model = universal_app
        message_id = str(message_id)

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model,
                user=current_user,
                message_id=message_id
            )
        except MessageNotExistsError:
            raise NotFound("Message not found")
        except ConversationNotExistsError:
            raise NotFound("Conversation not found")
        except SuggestedQuestionsAfterAnswerDisabledError:
            raise AppSuggestedQuestionsAfterAnswerDisabledError()
        except ProviderTokenNotInitError:
            raise ProviderNotInitializeError()
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except (LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError,
                LLMRateLimitError, LLMAuthorizationError) as e:
            raise CompletionRequestError(str(e))
        except Exception:
            logging.exception("internal server error.")
            raise InternalServerError()

        return {'data': questions}


api.add_resource(UniversalChatMessageListApi, '/universal-chat/messages')
api.add_resource(UniversalChatMessageFeedbackApi, '/universal-chat/messages/<uuid:message_id>/feedbacks')
api.add_resource(UniversalChatMessageSuggestedQuestionApi, '/universal-chat/messages/<uuid:message_id>/suggested-questions')
