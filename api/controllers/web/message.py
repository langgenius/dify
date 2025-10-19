import logging

from flask_restx import fields, marshal_with, reqparse
from flask_restx.inputs import int_range
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.web import web_ns
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
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from fields.conversation_fields import message_file_fields
from fields.message_fields import agent_thought_fields, feedback_fields, retriever_resource_fields
from fields.raws import FilesContainedField
from libs import helper
from libs.helper import TimestampField, uuid_value
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.errors.app import MoreLikeThisDisabledError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService

logger = logging.getLogger(__name__)


@web_ns.route("/messages")
class MessageListApi(WebApiResource):
    message_fields = {
        "id": fields.String,
        "conversation_id": fields.String,
        "parent_message_id": fields.String,
        "inputs": FilesContainedField,
        "query": fields.String,
        "answer": fields.String(attribute="re_sign_file_url_answer"),
        "message_files": fields.List(fields.Nested(message_file_fields)),
        "feedback": fields.Nested(feedback_fields, attribute="user_feedback", allow_null=True),
        "retriever_resources": fields.List(fields.Nested(retriever_resource_fields)),
        "created_at": TimestampField,
        "agent_thoughts": fields.List(fields.Nested(agent_thought_fields)),
        "metadata": fields.Raw(attribute="message_metadata_dict"),
        "status": fields.String,
        "error": fields.String,
    }

    message_infinite_scroll_pagination_fields = {
        "limit": fields.Integer,
        "has_more": fields.Boolean,
        "data": fields.List(fields.Nested(message_fields)),
    }

    @web_ns.doc("Get Message List")
    @web_ns.doc(description="Retrieve paginated list of messages from a conversation in a chat application.")
    @web_ns.doc(
        params={
            "conversation_id": {"description": "Conversation UUID", "type": "string", "required": True},
            "first_id": {"description": "First message ID for pagination", "type": "string", "required": False},
            "limit": {
                "description": "Number of messages to return (1-100)",
                "type": "integer",
                "required": False,
                "default": 20,
            },
        }
    )
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Conversation Not Found or Not a Chat App",
            500: "Internal Server Error",
        }
    )
    @marshal_with(message_infinite_scroll_pagination_fields)
    def get(self, app_model, end_user):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = (
            reqparse.RequestParser()
            .add_argument("conversation_id", required=True, type=uuid_value, location="args")
            .add_argument("first_id", type=uuid_value, location="args")
            .add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        )
        args = parser.parse_args()

        try:
            return MessageService.pagination_by_first_id(
                app_model, end_user, args["conversation_id"], args["first_id"], args["limit"]
            )
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


@web_ns.route("/messages/<uuid:message_id>/feedbacks")
class MessageFeedbackApi(WebApiResource):
    feedback_response_fields = {
        "result": fields.String,
    }

    @web_ns.doc("Create Message Feedback")
    @web_ns.doc(description="Submit feedback (like/dislike) for a specific message.")
    @web_ns.doc(params={"message_id": {"description": "Message UUID", "type": "string", "required": True}})
    @web_ns.doc(
        params={
            "rating": {
                "description": "Feedback rating",
                "type": "string",
                "enum": ["like", "dislike"],
                "required": False,
            },
            "content": {"description": "Feedback content/comment", "type": "string", "required": False},
        }
    )
    @web_ns.doc(
        responses={
            200: "Feedback submitted successfully",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Message Not Found",
            500: "Internal Server Error",
        }
    )
    @marshal_with(feedback_response_fields)
    def post(self, app_model, end_user, message_id):
        message_id = str(message_id)

        parser = (
            reqparse.RequestParser()
            .add_argument("rating", type=str, choices=["like", "dislike", None], location="json")
            .add_argument("content", type=str, location="json", default=None)
        )
        args = parser.parse_args()

        try:
            MessageService.create_feedback(
                app_model=app_model,
                message_id=message_id,
                user=end_user,
                rating=args.get("rating"),
                content=args.get("content"),
            )
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {"result": "success"}


@web_ns.route("/messages/<uuid:message_id>/more-like-this")
class MessageMoreLikeThisApi(WebApiResource):
    @web_ns.doc("Generate More Like This")
    @web_ns.doc(description="Generate a new completion similar to an existing message (completion apps only).")
    @web_ns.doc(
        params={
            "message_id": {"description": "Message UUID", "type": "string", "required": True},
            "response_mode": {
                "description": "Response mode",
                "type": "string",
                "enum": ["blocking", "streaming"],
                "required": True,
            },
        }
    )
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request - Not a completion app or feature disabled",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Message Not Found",
            500: "Internal Server Error",
        }
    )
    def get(self, app_model, end_user, message_id):
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        message_id = str(message_id)

        parser = reqparse.RequestParser().add_argument(
            "response_mode", type=str, required=True, choices=["blocking", "streaming"], location="args"
        )
        args = parser.parse_args()

        streaming = args["response_mode"] == "streaming"

        try:
            response = AppGenerateService.generate_more_like_this(
                app_model=app_model,
                user=end_user,
                message_id=message_id,
                invoke_from=InvokeFrom.WEB_APP,
                streaming=streaming,
            )

            return helper.compact_generate_response(response)
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
            logger.exception("internal server error.")
            raise InternalServerError()


@web_ns.route("/messages/<uuid:message_id>/suggested-questions")
class MessageSuggestedQuestionApi(WebApiResource):
    suggested_questions_response_fields = {
        "data": fields.List(fields.String),
    }

    @web_ns.doc("Get Suggested Questions")
    @web_ns.doc(description="Get suggested follow-up questions after a message (chat apps only).")
    @web_ns.doc(params={"message_id": {"description": "Message UUID", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request - Not a chat app or feature disabled",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Message Not Found or Conversation Not Found",
            500: "Internal Server Error",
        }
    )
    @marshal_with(suggested_questions_response_fields)
    def get(self, app_model, end_user, message_id):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotCompletionAppError()

        message_id = str(message_id)

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model, user=end_user, message_id=message_id, invoke_from=InvokeFrom.WEB_APP
            )
            # questions is a list of strings, not a list of Message objects
            # so we can directly return it
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
            logger.exception("internal server error.")
            raise InternalServerError()

        return {"data": questions}
