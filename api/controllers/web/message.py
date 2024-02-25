import json
import logging
from collections.abc import Generator
from typing import Union

from flask import Response, stream_with_context
from flask_restful import fields, marshal_with, reqparse
from flask_restful.inputs import int_range
from werkzeug.exceptions import InternalServerError, NotFound

import services
from controllers.web import api
from controllers.web.error import (
    AppMoreLikeThisDisabledError,
    AppSuggestedQuestionsAfterAnswerDisabledError,
    CompletionRequestError,
    NotChatAppError,
    NotCompletionAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.web.wraps import WebApiResource
from core.entities.application_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from fields.conversation_fields import message_file_fields
from fields.message_fields import agent_thought_fields
from libs.helper import TimestampField, uuid_value
from services.completion_service import CompletionService
from services.errors.app import MoreLikeThisDisabledError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_service import MessageService


class MessageListApi(WebApiResource):
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
        args = parser.parse_args()

        try:
            return MessageService.pagination_by_first_id(app_model, end_user,
                                                     args['conversation_id'], args['first_id'], args['limit'])
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.message.FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


class MessageFeedbackApi(WebApiResource):
    def post(self, app_model, end_user, message_id):
        message_id = str(message_id)

        parser = reqparse.RequestParser()
        parser.add_argument('rating', type=str, choices=['like', 'dislike', None], location='json')
        args = parser.parse_args()

        try:
            MessageService.create_feedback(app_model, message_id, end_user, args['rating'])
        except services.errors.message.MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {'result': 'success'}


class MessageMoreLikeThisApi(WebApiResource):
    def get(self, app_model, end_user, message_id):
        if app_model.mode != 'completion':
            raise NotCompletionAppError()

        message_id = str(message_id)

        parser = reqparse.RequestParser()
        parser.add_argument('response_mode', type=str, required=True, choices=['blocking', 'streaming'], location='args')
        args = parser.parse_args()

        streaming = args['response_mode'] == 'streaming'

        try:
            response = CompletionService.generate_more_like_this(
                app_model=app_model,
                user=end_user,
                message_id=message_id,
                invoke_from=InvokeFrom.WEB_APP,
                streaming=streaming
            )

            return compact_response(response)
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")
        except MoreLikeThisDisabledError:
            raise AppMoreLikeThisDisabledError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception:
            logging.exception("internal server error.")
            raise InternalServerError()


def compact_response(response: Union[dict, Generator]) -> Response:
    if isinstance(response, dict):
        return Response(response=json.dumps(response), status=200, mimetype='application/json')
    else:
        def generate() -> Generator:
            yield from response

        return Response(stream_with_context(generate()), status=200,
                        mimetype='text/event-stream')


class MessageSuggestedQuestionApi(WebApiResource):
    def get(self, app_model, end_user, message_id):
        if app_model.mode != 'chat':
            raise NotCompletionAppError()

        message_id = str(message_id)

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model,
                user=end_user,
                message_id=message_id
            )
        except MessageNotExistsError:
            raise NotFound("Message not found")
        except ConversationNotExistsError:
            raise NotFound("Conversation not found")
        except SuggestedQuestionsAfterAnswerDisabledError:
            raise AppSuggestedQuestionsAfterAnswerDisabledError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
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


api.add_resource(MessageListApi, '/messages')
api.add_resource(MessageFeedbackApi, '/messages/<uuid:message_id>/feedbacks')
api.add_resource(MessageMoreLikeThisApi, '/messages/<uuid:message_id>/more-like-this')
api.add_resource(MessageSuggestedQuestionApi, '/messages/<uuid:message_id>/suggested-questions')
