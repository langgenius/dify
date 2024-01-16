# -*- coding:utf-8 -*-
import logging

import services
from controllers.console.app.error import (CompletionRequestError, ProviderModelCurrentlyNotSupportError,
                                           ProviderNotInitializeError, ProviderQuotaExceededError)
from controllers.console.explore.error import AppSuggestedQuestionsAfterAnswerDisabledError
from controllers.console.universal_chat.wraps import UniversalChatResource
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from flask_login import current_user
from flask_restful import marshal_with, reqparse
from flask_restful.inputs import int_range
from fields.message_fields import message_infinite_scroll_pagination_fields
from libs.helper import uuid_value
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_service import MessageService
from werkzeug.exceptions import InternalServerError, NotFound


class UniversalChatMessageListApi(UniversalChatResource):
    
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
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except Exception:
            logging.exception("internal server error.")
            raise InternalServerError()

        return {'data': questions}

