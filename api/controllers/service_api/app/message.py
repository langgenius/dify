import json
import logging

from flask_restx import Api, Namespace, Resource, fields, reqparse
from flask_restx.inputs import int_range
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

import services
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.app.entities.app_invoke_entities import InvokeFrom
from fields.conversation_fields import build_message_file_model
from fields.message_fields import build_agent_thought_model, build_feedback_model
from fields.raws import FilesContainedField
from libs.helper import TimestampField, uuid_value
from models.model import App, AppMode, EndUser
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService

logger = logging.getLogger(__name__)


# Define parsers for message APIs
message_list_parser = (
    reqparse.RequestParser()
    .add_argument("conversation_id", required=True, type=uuid_value, location="args", help="Conversation ID")
    .add_argument("first_id", type=uuid_value, location="args", help="First message ID for pagination")
    .add_argument(
        "limit",
        type=int_range(1, 100),
        required=False,
        default=20,
        location="args",
        help="Number of messages to return",
    )
)

message_feedback_parser = (
    reqparse.RequestParser()
    .add_argument("rating", type=str, choices=["like", "dislike", None], location="json", help="Feedback rating")
    .add_argument("content", type=str, location="json", help="Feedback content")
)

feedback_list_parser = (
    reqparse.RequestParser()
    .add_argument("page", type=int, default=1, location="args", help="Page number")
    .add_argument(
        "limit",
        type=int_range(1, 101),
        required=False,
        default=20,
        location="args",
        help="Number of feedbacks per page",
    )
)


def build_message_model(api_or_ns: Api | Namespace):
    """Build the message model for the API or Namespace."""
    # First build the nested models
    feedback_model = build_feedback_model(api_or_ns)
    agent_thought_model = build_agent_thought_model(api_or_ns)
    message_file_model = build_message_file_model(api_or_ns)

    # Then build the message fields with nested models
    message_fields = {
        "id": fields.String,
        "conversation_id": fields.String,
        "parent_message_id": fields.String,
        "inputs": FilesContainedField,
        "query": fields.String,
        "answer": fields.String(attribute="re_sign_file_url_answer"),
        "message_files": fields.List(fields.Nested(message_file_model)),
        "feedback": fields.Nested(feedback_model, attribute="user_feedback", allow_null=True),
        "retriever_resources": fields.Raw(
            attribute=lambda obj: json.loads(obj.message_metadata).get("retriever_resources", [])
            if obj.message_metadata
            else []
        ),
        "created_at": TimestampField,
        "agent_thoughts": fields.List(fields.Nested(agent_thought_model)),
        "status": fields.String,
        "error": fields.String,
    }
    return api_or_ns.model("Message", message_fields)


def build_message_infinite_scroll_pagination_model(api_or_ns: Api | Namespace):
    """Build the message infinite scroll pagination model for the API or Namespace."""
    # Build the nested message model first
    message_model = build_message_model(api_or_ns)

    message_infinite_scroll_pagination_fields = {
        "limit": fields.Integer,
        "has_more": fields.Boolean,
        "data": fields.List(fields.Nested(message_model)),
    }
    return api_or_ns.model("MessageInfiniteScrollPagination", message_infinite_scroll_pagination_fields)


@service_api_ns.route("/messages")
class MessageListApi(Resource):
    @service_api_ns.expect(message_list_parser)
    @service_api_ns.doc("list_messages")
    @service_api_ns.doc(description="List messages in a conversation")
    @service_api_ns.doc(
        responses={
            200: "Messages retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Conversation or first message not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    @service_api_ns.marshal_with(build_message_infinite_scroll_pagination_model(service_api_ns))
    def get(self, app_model: App, end_user: EndUser):
        """List messages in a conversation.

        Retrieves messages with pagination support using first_id.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        args = message_list_parser.parse_args()

        try:
            return MessageService.pagination_by_first_id(
                app_model, end_user, args["conversation_id"], args["first_id"], args["limit"]
            )
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


@service_api_ns.route("/messages/<uuid:message_id>/feedbacks")
class MessageFeedbackApi(Resource):
    @service_api_ns.expect(message_feedback_parser)
    @service_api_ns.doc("create_message_feedback")
    @service_api_ns.doc(description="Submit feedback for a message")
    @service_api_ns.doc(params={"message_id": "Message ID"})
    @service_api_ns.doc(
        responses={
            200: "Feedback submitted successfully",
            401: "Unauthorized - invalid API token",
            404: "Message not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser, message_id):
        """Submit feedback for a message.

        Allows users to rate messages as like/dislike and provide optional feedback content.
        """
        message_id = str(message_id)

        args = message_feedback_parser.parse_args()

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


@service_api_ns.route("/app/feedbacks")
class AppGetFeedbacksApi(Resource):
    @service_api_ns.expect(feedback_list_parser)
    @service_api_ns.doc("get_app_feedbacks")
    @service_api_ns.doc(description="Get all feedbacks for the application")
    @service_api_ns.doc(
        responses={
            200: "Feedbacks retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @validate_app_token
    def get(self, app_model: App):
        """Get all feedbacks for the application.

        Returns paginated list of all feedback submitted for messages in this app.
        """
        args = feedback_list_parser.parse_args()
        feedbacks = MessageService.get_all_messages_feedbacks(app_model, page=args["page"], limit=args["limit"])
        return {"data": feedbacks}


@service_api_ns.route("/messages/<uuid:message_id>/suggested")
class MessageSuggestedApi(Resource):
    @service_api_ns.doc("get_suggested_questions")
    @service_api_ns.doc(description="Get suggested follow-up questions for a message")
    @service_api_ns.doc(params={"message_id": "Message ID"})
    @service_api_ns.doc(
        responses={
            200: "Suggested questions retrieved successfully",
            400: "Suggested questions feature is disabled",
            401: "Unauthorized - invalid API token",
            404: "Message not found",
            500: "Internal server error",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY, required=True))
    def get(self, app_model: App, end_user: EndUser, message_id):
        """Get suggested follow-up questions for a message.

        Returns AI-generated follow-up questions based on the message content.
        """
        message_id = str(message_id)
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model, user=end_user, message_id=message_id, invoke_from=InvokeFrom.SERVICE_API
            )
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")
        except SuggestedQuestionsAfterAnswerDisabledError:
            raise BadRequest("Suggested Questions Is Disabled.")
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()

        return {"result": "success", "data": questions}
