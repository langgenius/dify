import logging
from typing import Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, TypeAdapter
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

import services
from controllers.common.schema import register_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.app.entities.app_invoke_entities import InvokeFrom
from fields.conversation_fields import ResultResponse
from fields.message_fields import MessageInfiniteScrollPagination, MessageListItem
from models.model import App, AppMode, EndUser
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService

logger = logging.getLogger(__name__)


class MessageListQuery(BaseModel):
    conversation_id: UUID
    first_id: UUID | None = None
    limit: int = Field(default=20, ge=1, le=100, description="Number of messages to return")


class MessageFeedbackPayload(BaseModel):
    rating: Literal["like", "dislike"] | None = Field(default=None, description="Feedback rating")
    content: str | None = Field(default=None, description="Feedback content")


class FeedbackListQuery(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number")
    limit: int = Field(default=20, ge=1, le=101, description="Number of feedbacks per page")


register_schema_models(service_api_ns, MessageListQuery, MessageFeedbackPayload, FeedbackListQuery)


@service_api_ns.route("/messages")
class MessageListApi(Resource):
    @service_api_ns.expect(service_api_ns.models[MessageListQuery.__name__])
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
    def get(self, app_model: App, end_user: EndUser):
        """List messages in a conversation.

        Retrieves messages with pagination support using first_id.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        query_args = MessageListQuery.model_validate(request.args.to_dict())
        conversation_id = str(query_args.conversation_id)
        first_id = str(query_args.first_id) if query_args.first_id else None

        try:
            pagination = MessageService.pagination_by_first_id(
                app_model, end_user, conversation_id, first_id, query_args.limit
            )
            adapter = TypeAdapter(MessageListItem)
            items = [adapter.validate_python(message, from_attributes=True) for message in pagination.data]
            return MessageInfiniteScrollPagination(
                limit=pagination.limit,
                has_more=pagination.has_more,
                data=items,
            ).model_dump(mode="json")
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


@service_api_ns.route("/messages/<uuid:message_id>/feedbacks")
class MessageFeedbackApi(Resource):
    @service_api_ns.expect(service_api_ns.models[MessageFeedbackPayload.__name__])
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

        payload = MessageFeedbackPayload.model_validate(service_api_ns.payload or {})

        try:
            MessageService.create_feedback(
                app_model=app_model,
                message_id=message_id,
                user=end_user,
                rating=payload.rating,
                content=payload.content,
            )
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json")


@service_api_ns.route("/app/feedbacks")
class AppGetFeedbacksApi(Resource):
    @service_api_ns.expect(service_api_ns.models[FeedbackListQuery.__name__])
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
        query_args = FeedbackListQuery.model_validate(request.args.to_dict())
        feedbacks = MessageService.get_all_messages_feedbacks(app_model, page=query_args.page, limit=query_args.limit)
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
