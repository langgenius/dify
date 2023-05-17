import json
import logging
from typing import Union, Generator

from flask import Response, stream_with_context
from flask_login import current_user, login_required
from flask_restful import Resource, reqparse, marshal_with, fields
from flask_restful.inputs import int_range
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.console import api
from controllers.console.app import _get_app
from controllers.console.app.error import CompletionRequestError, ProviderNotInitializeError, \
    AppMoreLikeThisDisabledError, ProviderQuotaExceededError, ProviderModelCurrentlyNotSupportError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.llm.error import LLMRateLimitError, LLMBadRequestError, LLMAuthorizationError, LLMAPIConnectionError, \
    ProviderTokenNotInitError, LLMAPIUnavailableError, QuotaExceededError, ModelCurrentlyNotSupportError
from libs.helper import uuid_value, TimestampField
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from extensions.ext_database import db
from models.model import MessageAnnotation, Conversation, Message, MessageFeedback
from services.completion_service import CompletionService
from services.errors.app import MoreLikeThisDisabledError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError
from services.message_service import MessageService

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


class ChatMessageListApi(Resource):
    message_infinite_scroll_pagination_fields = {
        'limit': fields.Integer,
        'has_more': fields.Boolean,
        'data': fields.List(fields.Nested(message_detail_fields))
    }

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(message_infinite_scroll_pagination_fields)
    def get(self, app_id):
        app_id = str(app_id)

        # get app info
        app = _get_app(app_id, 'chat')

        parser = reqparse.RequestParser()
        parser.add_argument('conversation_id', required=True, type=uuid_value, location='args')
        parser.add_argument('first_id', type=uuid_value, location='args')
        parser.add_argument('limit', type=int_range(1, 100), required=False, default=20, location='args')
        args = parser.parse_args()

        conversation = db.session.query(Conversation).filter(
            Conversation.id == args['conversation_id'],
            Conversation.app_id == app.id
        ).first()

        if not conversation:
            raise NotFound("Conversation Not Exists.")

        if args['first_id']:
            first_message = db.session.query(Message) \
                .filter(Message.conversation_id == conversation.id, Message.id == args['first_id']).first()

            if not first_message:
                raise NotFound("First message not found")

            history_messages = db.session.query(Message).filter(
                Message.conversation_id == conversation.id,
                Message.created_at < first_message.created_at,
                Message.id != first_message.id
            ) \
                .order_by(Message.created_at.desc()).limit(args['limit']).all()
        else:
            history_messages = db.session.query(Message).filter(Message.conversation_id == conversation.id) \
                .order_by(Message.created_at.desc()).limit(args['limit']).all()

        has_more = False
        if len(history_messages) == args['limit']:
            current_page_first_message = history_messages[-1]
            rest_count = db.session.query(Message).filter(
                Message.conversation_id == conversation.id,
                Message.created_at < current_page_first_message.created_at,
                Message.id != current_page_first_message.id
            ).count()

            if rest_count > 0:
                has_more = True

        history_messages = list(reversed(history_messages))

        return InfiniteScrollPagination(
            data=history_messages,
            limit=args['limit'],
            has_more=has_more
        )


class MessageFeedbackApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id):
        app_id = str(app_id)

        # get app info
        app = _get_app(app_id)

        parser = reqparse.RequestParser()
        parser.add_argument('message_id', required=True, type=uuid_value, location='json')
        parser.add_argument('rating', type=str, choices=['like', 'dislike', None], location='json')
        args = parser.parse_args()

        message_id = str(args['message_id'])

        message = db.session.query(Message).filter(
            Message.id == message_id,
            Message.app_id == app.id
        ).first()

        if not message:
            raise NotFound("Message Not Exists.")

        feedback = message.admin_feedback

        if not args['rating'] and feedback:
            db.session.delete(feedback)
        elif args['rating'] and feedback:
            feedback.rating = args['rating']
        elif not args['rating'] and not feedback:
            raise ValueError('rating cannot be None when feedback not exists')
        else:
            feedback = MessageFeedback(
                app_id=app.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                rating=args['rating'],
                from_source='admin',
                from_account_id=current_user.id
            )
            db.session.add(feedback)

        db.session.commit()

        return {'result': 'success'}


class MessageAnnotationApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id):
        app_id = str(app_id)

        # get app info
        app = _get_app(app_id)

        parser = reqparse.RequestParser()
        parser.add_argument('message_id', required=True, type=uuid_value, location='json')
        parser.add_argument('content', type=str, location='json')
        args = parser.parse_args()

        message_id = str(args['message_id'])

        message = db.session.query(Message).filter(
            Message.id == message_id,
            Message.app_id == app.id
        ).first()

        if not message:
            raise NotFound("Message Not Exists.")

        annotation = message.annotation

        if annotation:
            annotation.content = args['content']
        else:
            annotation = MessageAnnotation(
                app_id=app.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                content=args['content'],
                account_id=current_user.id
            )
            db.session.add(annotation)

        db.session.commit()

        return {'result': 'success'}


class MessageAnnotationCountApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        app_id = str(app_id)

        # get app info
        app = _get_app(app_id)

        count = db.session.query(MessageAnnotation).filter(
            MessageAnnotation.app_id == app.id
        ).count()

        return {'count': count}


class MessageMoreLikeThisApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id, message_id):
        app_id = str(app_id)
        message_id = str(message_id)

        parser = reqparse.RequestParser()
        parser.add_argument('response_mode', type=str, required=True, choices=['blocking', 'streaming'],
                            location='args')
        args = parser.parse_args()

        streaming = args['response_mode'] == 'streaming'

        # get app info
        app_model = _get_app(app_id, 'completion')

        try:
            response = CompletionService.generate_more_like_this(app_model, current_user, message_id, streaming)
            return compact_response(response)
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")
        except MoreLikeThisDisabledError:
            raise AppMoreLikeThisDisabledError()
        except ProviderTokenNotInitError:
            raise ProviderNotInitializeError()
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except (LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError,
                LLMRateLimitError, LLMAuthorizationError) as e:
            raise CompletionRequestError(str(e))
        except ValueError as e:
            raise e
        except Exception as e:
            logging.exception("internal server error.")
            raise InternalServerError()


def compact_response(response: Union[dict | Generator]) -> Response:
    if isinstance(response, dict):
        return Response(response=json.dumps(response), status=200, mimetype='application/json')
    else:
        def generate() -> Generator:
            try:
                for chunk in response:
                    yield chunk
            except MessageNotExistsError:
                yield "data: " + json.dumps(api.handle_error(NotFound("Message Not Exists.")).get_json()) + "\n\n"
            except MoreLikeThisDisabledError:
                yield "data: " + json.dumps(api.handle_error(AppMoreLikeThisDisabledError()).get_json()) + "\n\n"
            except ProviderTokenNotInitError:
                yield "data: " + json.dumps(api.handle_error(ProviderNotInitializeError()).get_json()) + "\n\n"
            except QuotaExceededError:
                yield "data: " + json.dumps(api.handle_error(ProviderQuotaExceededError()).get_json()) + "\n\n"
            except ModelCurrentlyNotSupportError:
                yield "data: " + json.dumps(
                    api.handle_error(ProviderModelCurrentlyNotSupportError()).get_json()) + "\n\n"
            except (LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError,
                    LLMRateLimitError, LLMAuthorizationError) as e:
                yield "data: " + json.dumps(api.handle_error(CompletionRequestError(str(e))).get_json()) + "\n\n"
            except ValueError as e:
                yield "data: " + json.dumps(api.handle_error(e).get_json()) + "\n\n"
            except Exception:
                logging.exception("internal server error.")
                yield "data: " + json.dumps(api.handle_error(InternalServerError()).get_json()) + "\n\n"

        return Response(stream_with_context(generate()), status=200,
                        mimetype='text/event-stream')


class MessageSuggestedQuestionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id, message_id):
        app_id = str(app_id)
        message_id = str(message_id)

        # get app info
        app_model = _get_app(app_id, 'chat')

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model,
                user=current_user,
                message_id=message_id,
                check_enabled=False
            )
        except MessageNotExistsError:
            raise NotFound("Message not found")
        except ConversationNotExistsError:
            raise NotFound("Conversation not found")
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


class MessageApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(message_detail_fields)
    def get(self, app_id, message_id):
        app_id = str(app_id)
        message_id = str(message_id)

        # get app info
        app_model = _get_app(app_id, 'chat')

        message = db.session.query(Message).filter(
            Message.id == message_id,
            Message.app_id == app_model.id
        ).first()

        if not message:
            raise NotFound("Message Not Exists.")

        return message


api.add_resource(MessageMoreLikeThisApi, '/apps/<uuid:app_id>/completion-messages/<uuid:message_id>/more-like-this')
api.add_resource(MessageSuggestedQuestionApi, '/apps/<uuid:app_id>/chat-messages/<uuid:message_id>/suggested-questions')
api.add_resource(ChatMessageListApi, '/apps/<uuid:app_id>/chat-messages', endpoint='console_chat_messages')
api.add_resource(MessageFeedbackApi, '/apps/<uuid:app_id>/feedbacks')
api.add_resource(MessageAnnotationApi, '/apps/<uuid:app_id>/annotations')
api.add_resource(MessageAnnotationCountApi, '/apps/<uuid:app_id>/annotations/count')
api.add_resource(MessageApi, '/apps/<uuid:app_id>/messages/<uuid:message_id>', endpoint='console_message')
