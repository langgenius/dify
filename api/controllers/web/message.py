import logging
from typing import Literal

from flask import request
from pydantic import BaseModel, Field, TypeAdapter, field_validator
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.common.schema import register_schema_models
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
from fields.conversation_fields import ResultResponse
from fields.message_fields import SuggestedQuestionsResponse, WebMessageInfiniteScrollPagination, WebMessageListItem
from libs import helper
from libs.helper import uuid_value
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


class MessageListQuery(BaseModel):
    conversation_id: str = Field(description="Conversation UUID")
    first_id: str | None = Field(default=None, description="First message ID for pagination")
    limit: int = Field(default=20, ge=1, le=100, description="Number of messages to return (1-100)")

    @field_validator("conversation_id", "first_id")
    @classmethod
    def validate_uuid(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


class MessageFeedbackPayload(BaseModel):
    rating: Literal["like", "dislike"] | None = Field(default=None, description="Feedback rating")
    content: str | None = Field(default=None, description="Feedback content")


class MessageMoreLikeThisQuery(BaseModel):
    response_mode: Literal["blocking", "streaming"] = Field(
        description="Response mode",
    )


register_schema_models(web_ns, MessageListQuery, MessageFeedbackPayload, MessageMoreLikeThisQuery)


@web_ns.route("/messages")
class MessageListApi(WebApiResource):
    @web_ns.doc("Get Message List")
    @web_ns.doc(description="Retrieve paginated list of messages from a conversation in a chat application.")
    @web_ns.doc(
        params={
            "conversation_id": {"description": "Conversation UUID", "type": "string", "required": True},
            "first_id": {
                "description": "First message ID for pagination",
                "type": "string",
                "required": False,
            },
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
    def get(self, app_model, end_user):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        raw_args = request.args.to_dict()
        query = MessageListQuery.model_validate(raw_args)

        try:
            pagination = MessageService.pagination_by_first_id(
                app_model, end_user, query.conversation_id, query.first_id, query.limit
            )
            adapter = TypeAdapter(WebMessageListItem)
            items = [adapter.validate_python(message, from_attributes=True) for message in pagination.data]
            return WebMessageInfiniteScrollPagination(
                limit=pagination.limit,
                has_more=pagination.has_more,
                data=items,
            ).model_dump(mode="json")
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


@web_ns.route("/messages/<uuid:message_id>/feedbacks")
class MessageFeedbackApi(WebApiResource):
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
            "content": {"description": "Feedback content", "type": "string", "required": False},
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
    def post(self, app_model, end_user, message_id):
        message_id = str(message_id)

        payload = MessageFeedbackPayload.model_validate(web_ns.payload or {})

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


@web_ns.route("/messages/<uuid:message_id>/more-like-this")
class MessageMoreLikeThisApi(WebApiResource):
    @web_ns.doc("Generate More Like This")
    @web_ns.doc(description="Generate a new completion similar to an existing message (completion apps only).")
    @web_ns.expect(web_ns.models[MessageMoreLikeThisQuery.__name__])
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

        raw_args = request.args.to_dict()
        query = MessageMoreLikeThisQuery.model_validate(raw_args)

        streaming = query.response_mode == "streaming"

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

        return SuggestedQuestionsResponse(data=questions).model_dump(mode="json")
