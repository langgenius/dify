import logging

from flask_login import current_user
from flask_restful import Resource, fields, marshal_with, reqparse
from flask_restful.inputs import int_range
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

from controllers.console import api
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.app.wraps import get_app_model
from controllers.console.explore.error import AppSuggestedQuestionsAfterAnswerDisabledError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from extensions.ext_database import db
from fields.conversation_fields import annotation_fields, message_detail_fields
from libs.helper import uuid_value
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from libs.login import login_required
from models.model import AppMode, Conversation, Message, MessageAnnotation, MessageFeedback
from services.annotation_service import AppAnnotationService
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_service import MessageService


class ChatMessageListApi(Resource):
    message_infinite_scroll_pagination_fields = {
        "limit": fields.Integer,
        "has_more": fields.Boolean,
        "data": fields.List(fields.Nested(message_detail_fields)),
    }

    @setup_required
    @login_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    @account_initialization_required
    @marshal_with(message_infinite_scroll_pagination_fields)
    def get(self, app_model):
        parser = reqparse.RequestParser()
        parser.add_argument("conversation_id", required=True, type=uuid_value, location="args")
        parser.add_argument("first_id", type=uuid_value, location="args")
        parser.add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        args = parser.parse_args()

        conversation = (
            db.session.query(Conversation)
            .filter(Conversation.id == args["conversation_id"], Conversation.app_id == app_model.id)
            .first()
        )

        if not conversation:
            raise NotFound("Conversation Not Exists.")

        if args["first_id"]:
            first_message = (
                db.session.query(Message)
                .filter(Message.conversation_id == conversation.id, Message.id == args["first_id"])
                .first()
            )

            if not first_message:
                raise NotFound("First message not found")

            history_messages = (
                db.session.query(Message)
                .filter(
                    Message.conversation_id == conversation.id,
                    Message.created_at < first_message.created_at,
                    Message.id != first_message.id,
                )
                .order_by(Message.created_at.desc())
                .limit(args["limit"])
                .all()
            )
        else:
            history_messages = (
                db.session.query(Message)
                .filter(Message.conversation_id == conversation.id)
                .order_by(Message.created_at.desc())
                .limit(args["limit"])
                .all()
            )

        has_more = False
        if len(history_messages) == args["limit"]:
            current_page_first_message = history_messages[-1]
            rest_count = (
                db.session.query(Message)
                .filter(
                    Message.conversation_id == conversation.id,
                    Message.created_at < current_page_first_message.created_at,
                    Message.id != current_page_first_message.id,
                )
                .count()
            )

            if rest_count > 0:
                has_more = True

        return InfiniteScrollPagination(data=history_messages, limit=args["limit"], has_more=has_more)


class MessageFeedbackApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def post(self, app_model):
        parser = reqparse.RequestParser()
        parser.add_argument("message_id", required=True, type=uuid_value, location="json")
        parser.add_argument("rating", type=str, choices=["like", "dislike", None], location="json")
        args = parser.parse_args()

        message_id = str(args["message_id"])

        message = db.session.query(Message).filter(Message.id == message_id, Message.app_id == app_model.id).first()

        if not message:
            raise NotFound("Message Not Exists.")

        feedback = message.admin_feedback

        if not args["rating"] and feedback:
            db.session.delete(feedback)
        elif args["rating"] and feedback:
            feedback.rating = args["rating"]
        elif not args["rating"] and not feedback:
            raise ValueError("rating cannot be None when feedback not exists")
        else:
            feedback = MessageFeedback(
                app_id=app_model.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                rating=args["rating"],
                from_source="admin",
                from_account_id=current_user.id,
            )
            db.session.add(feedback)

        db.session.commit()

        return {"result": "success"}


class MessageAnnotationApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @get_app_model
    @marshal_with(annotation_fields)
    def post(self, app_model):
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("message_id", required=False, type=uuid_value, location="json")
        parser.add_argument("question", required=True, type=str, location="json")
        parser.add_argument("answer", required=True, type=str, location="json")
        parser.add_argument("annotation_reply", required=False, type=dict, location="json")
        args = parser.parse_args()
        annotation = AppAnnotationService.up_insert_app_annotation_from_message(args, app_model.id)

        return annotation


class MessageAnnotationCountApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model):
        count = db.session.query(MessageAnnotation).filter(MessageAnnotation.app_id == app_model.id).count()

        return {"count": count}


class MessageSuggestedQuestionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    def get(self, app_model, message_id):
        message_id = str(message_id)

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model, message_id=message_id, user=current_user, invoke_from=InvokeFrom.DEBUGGER
            )
        except MessageNotExistsError:
            raise NotFound("Message not found")
        except ConversationNotExistsError:
            raise NotFound("Conversation not found")
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except SuggestedQuestionsAfterAnswerDisabledError:
            raise AppSuggestedQuestionsAfterAnswerDisabledError()
        except Exception:
            logging.exception("internal server error.")
            raise InternalServerError()

        return {"data": questions}


class MessageApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(message_detail_fields)
    def get(self, app_model, message_id):
        message_id = str(message_id)

        message = db.session.query(Message).filter(Message.id == message_id, Message.app_id == app_model.id).first()

        if not message:
            raise NotFound("Message Not Exists.")

        return message


api.add_resource(MessageSuggestedQuestionApi, "/apps/<uuid:app_id>/chat-messages/<uuid:message_id>/suggested-questions")
api.add_resource(ChatMessageListApi, "/apps/<uuid:app_id>/chat-messages", endpoint="console_chat_messages")
api.add_resource(MessageFeedbackApi, "/apps/<uuid:app_id>/feedbacks")
api.add_resource(MessageAnnotationApi, "/apps/<uuid:app_id>/annotations")
api.add_resource(MessageAnnotationCountApi, "/apps/<uuid:app_id>/annotations/count")
api.add_resource(MessageApi, "/apps/<uuid:app_id>/messages/<uuid:message_id>", endpoint="console_message")
