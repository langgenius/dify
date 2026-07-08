import logging
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, TypeAdapter
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

import services
from controllers.common.controller_schemas import MessageFeedbackPayload, MessageListQuery
from controllers.common.fields import SimpleResultStringListResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.schema import expect_with_user
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.conversation_fields import ResultResponse
from fields.message_fields import MessageInfiniteScrollPagination, MessageListItem
from models.enums import FeedbackRating
from models.model import App, AppMode, EndUser
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService

logger = logging.getLogger(__name__)


class FeedbackListQuery(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number for pagination.")
    limit: int = Field(default=20, ge=1, le=101, description="Number of records per page.")


class AppFeedbackResponse(ResponseModel):
    id: str
    app_id: str
    conversation_id: str
    message_id: str
    rating: str
    content: str | None = None
    from_source: str
    from_end_user_id: str | None = None
    from_account_id: str | None = None
    created_at: str
    updated_at: str


class AppFeedbackListResponse(ResponseModel):
    data: list[AppFeedbackResponse]


register_schema_models(service_api_ns, MessageListQuery, MessageFeedbackPayload, FeedbackListQuery)
register_response_schema_models(
    service_api_ns,
    ResultResponse,
    SimpleResultStringListResponse,
    MessageInfiniteScrollPagination,
    AppFeedbackListResponse,
)


@service_api_ns.route("/messages")
class MessageListApi(Resource):
    @service_api_ns.doc(
        summary="List Conversation Messages",
        description=(
            "Returns historical chat records in a scrolling load format, with the first page returning "
            "the latest `limit` messages, i.e., in reverse order."
        ),
        tags=["Conversations"],
        responses={
            200: "Successfully retrieved conversation history.",
            400: "`not_chat_app` : App mode does not match the API route.",
            404: ("- `not_found` : Conversation does not exist.\n- `not_found` : First message does not exist."),
        },
    )
    @service_api_ns.doc(params=query_params_from_model(MessageListQuery))
    @service_api_ns.doc("list_messages")
    @service_api_ns.doc(description="List messages in a conversation")
    @service_api_ns.doc(
        responses={
            200: "Messages retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Conversation or first message not found",
        }
    )
    @service_api_ns.response(
        200,
        "Messages retrieved successfully",
        service_api_ns.models[MessageInfiniteScrollPagination.__name__],
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    def get(self, app_model: App, end_user: EndUser):
        """List messages in a conversation.

        Retrieves messages with pagination support using first_id.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        query_args = MessageListQuery.model_validate(request.args.to_dict())
        conversation_id = str(query_args.conversation_id)
        first_id = str(query_args.first_id) if query_args.first_id else None

        try:
            pagination = MessageService.pagination_by_first_id(
                app_model, end_user, conversation_id, first_id, query_args.limit, session=db.session()
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
    @service_api_ns.doc(
        summary="Submit Message Feedback",
        description=(
            "Submit feedback for a message. End users can rate messages as `like` or `dislike`, and "
            "optionally provide text feedback. Pass `null` for `rating` to revoke previously submitted "
            "feedback."
        ),
        tags=["Feedback"],
        responses={
            404: "`not_found` : Message does not exist.",
        },
    )
    @expect_with_user(service_api_ns, MessageFeedbackPayload)
    @service_api_ns.response(200, "Feedback submitted successfully", service_api_ns.models[ResultResponse.__name__])
    @service_api_ns.doc("create_message_feedback")
    @service_api_ns.doc(description="Submit feedback for a message")
    @service_api_ns.doc(params={"message_id": "Message ID."})
    @service_api_ns.doc(
        responses={
            200: "Feedback submitted successfully",
            401: "Unauthorized - invalid API token",
            404: "Message not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser, message_id: UUID):
        """Submit feedback for a message.

        Allows users to rate messages as like/dislike and provide optional feedback content.
        """
        message_id_str = str(message_id)

        payload = MessageFeedbackPayload.model_validate(service_api_ns.payload or {})

        try:
            MessageService.create_feedback(
                app_model=app_model,
                message_id=message_id_str,
                user=end_user,
                rating=FeedbackRating(payload.rating) if payload.rating else None,
                content=payload.content,
                session=db.session(),
            )
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json")


@service_api_ns.route("/app/feedbacks")
class AppGetFeedbacksApi(Resource):
    @service_api_ns.doc(
        summary="List App Feedbacks",
        description=(
            "Retrieve a paginated list of all feedback submitted for messages in this application, "
            "including both end-user and admin feedback."
        ),
        tags=["Feedback"],
        responses={
            200: "A list of application feedbacks.",
        },
    )
    @service_api_ns.doc(params=query_params_from_model(FeedbackListQuery))
    @service_api_ns.doc("get_app_feedbacks")
    @service_api_ns.doc(description="Get all feedbacks for the application")
    @service_api_ns.doc(
        responses={
            200: "Feedbacks retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.response(
        200,
        "Feedbacks retrieved successfully",
        service_api_ns.models[AppFeedbackListResponse.__name__],
    )
    @validate_app_token
    def get(self, app_model: App):
        """Get all feedbacks for the application.

        Returns paginated list of all feedback submitted for messages in this app.
        """
        query_args = FeedbackListQuery.model_validate(request.args.to_dict())
        feedbacks = MessageService.get_all_messages_feedbacks(
            app_model, page=query_args.page, limit=query_args.limit, session=db.session()
        )
        return {"data": feedbacks}


@service_api_ns.route("/messages/<uuid:message_id>/suggested")
class MessageSuggestedApi(Resource):
    @service_api_ns.doc(
        summary="Get Next Suggested Questions",
        description="Get next questions suggestions for the current message.",
        tags=["Chats", "Chatflows"],
        responses={
            200: "Successfully retrieved suggested questions.",
            400: (
                "- `not_chat_app` : App mode does not match the API route.\n"
                "- `bad_request` : Suggested questions feature is disabled."
            ),
            404: "`not_found` : Message does not exist.",
            500: "`internal_server_error` : Internal server error.",
        },
    )
    @service_api_ns.response(
        200,
        "Suggested questions retrieved successfully",
        service_api_ns.models[SimpleResultStringListResponse.__name__],
    )
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
    def get(self, app_model: App, end_user: EndUser, message_id: UUID):
        """Get suggested follow-up questions for a message.

        Returns AI-generated follow-up questions based on the message content.
        """
        message_id_str = str(message_id)
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model,
                user=end_user,
                message_id=message_id_str,
                invoke_from=InvokeFrom.SERVICE_API,
                session=db.session(),
            )
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")
        except SuggestedQuestionsAfterAnswerDisabledError:
            raise BadRequest("Suggested Questions Is Disabled.")
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()

        return {"result": "success", "data": questions}
