import logging

from flask_restx import Resource, fields, marshal_with, reqparse
from flask_restx.inputs import int_range
from sqlalchemy import exists, select
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.console import api, console_ns
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.app.wraps import get_app_model
from controllers.console.explore.error import AppSuggestedQuestionsAfterAnswerDisabledError
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    setup_required,
)
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from extensions.ext_database import db
from fields.conversation_fields import message_detail_fields
from libs.helper import uuid_value
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from libs.login import current_account_with_tenant, login_required
from models.model import AppMode, Conversation, Message, MessageAnnotation, MessageFeedback
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_service import MessageService

logger = logging.getLogger(__name__)


@console_ns.route("/apps/<uuid:app_id>/chat-messages")
class ChatMessageListApi(Resource):
    message_infinite_scroll_pagination_fields = {
        "limit": fields.Integer,
        "has_more": fields.Boolean,
        "data": fields.List(fields.Nested(message_detail_fields)),
    }

    @api.doc("list_chat_messages")
    @api.doc(description="Get chat messages for a conversation with pagination")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.parser()
        .add_argument("conversation_id", type=str, required=True, location="args", help="Conversation ID")
        .add_argument("first_id", type=str, location="args", help="First message ID for pagination")
        .add_argument("limit", type=int, location="args", default=20, help="Number of messages to return (1-100)")
    )
    @api.response(200, "Success", message_infinite_scroll_pagination_fields)
    @api.response(404, "Conversation not found")
    @login_required
    @account_initialization_required
    @setup_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    @marshal_with(message_infinite_scroll_pagination_fields)
    @edit_permission_required
    def get(self, app_model):
        parser = (
            reqparse.RequestParser()
            .add_argument("conversation_id", required=True, type=uuid_value, location="args")
            .add_argument("first_id", type=uuid_value, location="args")
            .add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        )
        args = parser.parse_args()

        conversation = (
            db.session.query(Conversation)
            .where(Conversation.id == args["conversation_id"], Conversation.app_id == app_model.id)
            .first()
        )

        if not conversation:
            raise NotFound("Conversation Not Exists.")

        if args["first_id"]:
            first_message = (
                db.session.query(Message)
                .where(Message.conversation_id == conversation.id, Message.id == args["first_id"])
                .first()
            )

            if not first_message:
                raise NotFound("First message not found")

            history_messages = (
                db.session.query(Message)
                .where(
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
                .where(Message.conversation_id == conversation.id)
                .order_by(Message.created_at.desc())
                .limit(args["limit"])
                .all()
            )

        # Initialize has_more based on whether we have a full page
        if len(history_messages) == args["limit"]:
            current_page_first_message = history_messages[-1]
            # Check if there are more messages before the current page
            has_more = db.session.scalar(
                select(
                    exists().where(
                        Message.conversation_id == conversation.id,
                        Message.created_at < current_page_first_message.created_at,
                        Message.id != current_page_first_message.id,
                    )
                )
            )
        else:
            # If we don't have a full page, there are no more messages
            has_more = False

        history_messages = list(reversed(history_messages))

        return InfiniteScrollPagination(data=history_messages, limit=args["limit"], has_more=has_more)


@console_ns.route("/apps/<uuid:app_id>/feedbacks")
class MessageFeedbackApi(Resource):
    @api.doc("create_message_feedback")
    @api.doc(description="Create or update message feedback (like/dislike)")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "MessageFeedbackRequest",
            {
                "message_id": fields.String(required=True, description="Message ID"),
                "rating": fields.String(enum=["like", "dislike"], description="Feedback rating"),
            },
        )
    )
    @api.response(200, "Feedback updated successfully")
    @api.response(404, "Message not found")
    @api.response(403, "Insufficient permissions")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_model):
        current_user, _ = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("message_id", required=True, type=uuid_value, location="json")
            .add_argument("rating", type=str, choices=["like", "dislike", None], location="json")
        )
        args = parser.parse_args()

        message_id = str(args["message_id"])

        message = db.session.query(Message).where(Message.id == message_id, Message.app_id == app_model.id).first()

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


@console_ns.route("/apps/<uuid:app_id>/annotations/count")
class MessageAnnotationCountApi(Resource):
    @api.doc("get_annotation_count")
    @api.doc(description="Get count of message annotations for the app")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(
        200,
        "Annotation count retrieved successfully",
        api.model("AnnotationCountResponse", {"count": fields.Integer(description="Number of annotations")}),
    )
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_model):
        count = db.session.query(MessageAnnotation).where(MessageAnnotation.app_id == app_model.id).count()

        return {"count": count}


@console_ns.route("/apps/<uuid:app_id>/chat-messages/<uuid:message_id>/suggested-questions")
class MessageSuggestedQuestionApi(Resource):
    @api.doc("get_message_suggested_questions")
    @api.doc(description="Get suggested questions for a message")
    @api.doc(params={"app_id": "Application ID", "message_id": "Message ID"})
    @api.response(
        200,
        "Suggested questions retrieved successfully",
        api.model("SuggestedQuestionsResponse", {"data": fields.List(fields.String(description="Suggested question"))}),
    )
    @api.response(404, "Message or conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    def get(self, app_model, message_id):
        current_user, _ = current_account_with_tenant()
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
            logger.exception("internal server error.")
            raise InternalServerError()

        return {"data": questions}


@console_ns.route("/apps/<uuid:app_id>/messages/<uuid:message_id>")
class MessageApi(Resource):
    @api.doc("get_message")
    @api.doc(description="Get message details by ID")
    @api.doc(params={"app_id": "Application ID", "message_id": "Message ID"})
    @api.response(200, "Message retrieved successfully", message_detail_fields)
    @api.response(404, "Message not found")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(message_detail_fields)
    def get(self, app_model, message_id: str):
        message_id = str(message_id)

        message = db.session.query(Message).where(Message.id == message_id, Message.app_id == app_model.id).first()

        if not message:
            raise NotFound("Message Not Exists.")

        return message
