import logging
from http import HTTPStatus
from typing import Annotated
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, TypeAdapter, WithJsonSchema

import services
from controllers.common.controller_schemas import MessageFeedbackPayload, MessageListQuery
from controllers.common.errors import InternalServerError, MessageFeedbackRatingRequiredError, NotFoundError
from controllers.common.fields import SimpleResultStringListResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import (
    AppSuggestedQuestionsAfterAnswerDisabledError,
    AppUnavailableError,
    CompletionRequestError,
    NotChatAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api.flask_admission import service_api_app_admission, service_api_end_user_admission
from controllers.service_api.schema import expect_with_user
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.conversation_fields import MessageResponseSource, ResultResponse
from fields.message_fields import MessageInfiniteScrollPagination, MessageListItem
from graphon.model_runtime.errors.invoke import InvokeError
from libs.helper import dump_response
from machinery.context import ServiceApiEndUserContext, ServiceApiRequestContext
from models.enums import FeedbackRating
from models.model import App, AppMode, EndUser
from services.agent.errors import AgentVersionNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.entities.message_entities import MessageEndUser
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    FeedbackRatingRequiredError,
    FirstMessageNotExistsError,
    MessageActorNotFoundError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService

logger = logging.getLogger(__name__)


UUIDString = Annotated[str, WithJsonSchema({"format": "uuid", "type": "string"})]


class FeedbackListQuery(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number for pagination.")
    limit: int = Field(default=20, ge=1, le=101, description="Number of records per page.")


class AppFeedbackResponse(ResponseModel):
    id: UUIDString
    app_id: UUIDString
    conversation_id: UUIDString
    message_id: UUIDString
    rating: str
    content: str | None = None
    from_source: str
    from_end_user_id: UUIDString | None = None
    from_account_id: UUIDString | None = None
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
    MessageListItem,
    AppFeedbackListResponse,
)


@service_api_ns.route("/messages")
class MessageListApi(Resource):
    @service_api_ns.doc("list_messages")
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
            404: "- `not_found` : Conversation does not exist.\n- `not_found` : First message does not exist.",
        },
    )
    @service_api_ns.doc(params=query_params_from_model(MessageListQuery))
    @service_api_ns.doc(description="List messages in a conversation")
    @service_api_ns.doc(
        responses={
            200: "Messages retrieved successfully",
            400: "`not_chat_app` : App mode does not match the API route.",
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
    @model_validate(MessageListQuery)
    def get(self, query_args: MessageListQuery, app_model: App, end_user: EndUser):
        """List messages in a conversation.

        Retrieves messages with pagination support using first_id.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        conversation_id = query_args.conversation_id
        first_id = query_args.first_id or None

        try:
            session = db.session()
            pagination = MessageService.pagination_by_first_id(
                app_model, end_user, conversation_id, first_id, query_args.limit, session=session
            )
            adapter = TypeAdapter(MessageListItem)
            items = [
                adapter.validate_python(MessageResponseSource(message, session=session), from_attributes=True)
                for message in pagination.data
            ]
            return MessageInfiniteScrollPagination(
                limit=pagination.limit, has_more=pagination.has_more, data=items
            ).model_dump(mode="json")
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFoundError("Conversation Not Exists.")
        except FirstMessageNotExistsError:
            raise NotFoundError("First Message Not Exists.")


@service_api_ns.route("/messages/<uuid:message_id>/feedbacks")
class MessageFeedbackApi(Resource):
    @expect_with_user(service_api_ns, MessageFeedbackPayload)
    @service_api_ns.response(
        HTTPStatus.OK, "Feedback submitted successfully", service_api_ns.models[ResultResponse.__name__]
    )
    @service_api_ns.doc("create_message_feedback")
    @service_api_ns.doc(
        summary="Submit Message Feedback",
        description=(
            "Submit feedback for a message. End users can rate messages as `like` or `dislike`, and "
            "optionally provide text feedback. Pass `null` for `rating` to revoke previously submitted feedback."
        ),
        tags=["Feedback"],
        responses={
            HTTPStatus.NOT_FOUND: "`not_found` : Message does not exist.",
        },
    )
    @service_api_ns.doc(description="Submit feedback for a message")
    @service_api_ns.doc(params={"message_id": "Message ID."})
    @service_api_ns.doc(
        responses={
            HTTPStatus.OK: "Feedback submitted successfully",
            HTTPStatus.BAD_REQUEST: (
                "`message_feedback_rating_required`: Cannot revoke feedback that does not exist. "
                "`app_unavailable`: App is no longer available."
            ),
            HTTPStatus.UNAUTHORIZED: "Unauthorized - invalid API token",
            HTTPStatus.NOT_FOUND: "Message not found",
        }
    )
    @service_api_end_user_admission(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    @model_validate(MessageFeedbackPayload)
    def post(
        self,
        payload: MessageFeedbackPayload,
        context: ServiceApiEndUserContext,
        message_id: UUID,
    ) -> dict[str, object]:
        """Submit feedback for a message.

        Allows users to rate messages as like/dislike and provide optional feedback content.
        """
        message_id_str = str(message_id)

        try:
            application_services().message_feedbacks.set_feedback(
                app_id=context.app_id,
                app_owner_tenant_id=context.tenant_id,
                message_id=message_id_str,
                actor=MessageEndUser(end_user_id=context.end_user_id),
                rating=FeedbackRating(payload.rating) if payload.rating else None,
                content=payload.content,
            )
        except AppDefinitionUnavailableError as error:
            raise AppUnavailableError() from error
        except MessageActorNotFoundError as error:
            raise NotFoundError("End user not found") from error
        except MessageNotExistsError as error:
            raise NotFoundError("Message Not Exists.") from error
        except FeedbackRatingRequiredError as error:
            raise MessageFeedbackRatingRequiredError() from error

        return dump_response(ResultResponse, {"result": "success"})


@service_api_ns.route("/app/feedbacks")
class AppGetFeedbacksApi(Resource):
    @service_api_ns.doc("get_app_feedbacks")
    @service_api_ns.doc(
        summary="List App Feedbacks",
        description=(
            "Retrieve a paginated list of all feedback submitted for messages in this application, including both "
            "end-user and admin feedback."
        ),
        tags=["Feedback"],
        responses={
            HTTPStatus.OK: "A list of application feedbacks.",
        },
    )
    @service_api_ns.doc(params=query_params_from_model(FeedbackListQuery))
    @service_api_ns.doc(description="Get all feedbacks for the application")
    @service_api_ns.doc(
        responses={
            HTTPStatus.OK: "Feedbacks retrieved successfully",
            HTTPStatus.BAD_REQUEST: "`app_unavailable`: App is no longer available.",
            HTTPStatus.UNAUTHORIZED: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.response(
        HTTPStatus.OK,
        "Feedbacks retrieved successfully",
        service_api_ns.models[AppFeedbackListResponse.__name__],
    )
    @service_api_app_admission
    @model_validate(FeedbackListQuery)
    def get(self, query_args: FeedbackListQuery, context: ServiceApiRequestContext) -> dict[str, object]:
        """Get all feedbacks for the application.

        Returns paginated list of all feedback submitted for messages in this app.
        """
        try:
            feedbacks = application_services().message_feedbacks.get_feedbacks(
                app_id=context.app_id,
                app_owner_tenant_id=context.tenant_id,
                page=query_args.page,
                limit=query_args.limit,
            )
        except AppDefinitionUnavailableError as error:
            raise AppUnavailableError() from error
        return dump_response(AppFeedbackListResponse, {"data": feedbacks})


@service_api_ns.route("/messages/<uuid:message_id>/suggested")
class MessageSuggestedApi(Resource):
    @service_api_ns.doc("get_suggested_questions")
    @service_api_ns.doc(
        summary="Get Next Suggested Questions",
        description=(
            "Get next question suggestions for the current message. "
            "If no usable model can be resolved or the model call to generate questions fails, "
            "the response is HTTP 200 with an empty data list. "
            "Model invocation failures during history token counting instead return "
            "HTTP 400 with `completion_request_error`."
        ),
        tags=["Chats", "Chatflows"],
        responses={
            HTTPStatus.OK: "Suggested questions retrieved successfully",
            HTTPStatus.BAD_REQUEST: (
                "- `not_chat_app` : App mode does not match the API route.\n"
                "- `app_unavailable` : App is no longer available.\n"
                "- `completion_request_error` : Model invocation failed while counting history tokens."
            ),
            HTTPStatus.UNAUTHORIZED: "Unauthorized - invalid API token",
            HTTPStatus.FORBIDDEN: (
                "- `forbidden` : Token scope does not allow access.\n"
                "- `app_not_found` : The token's app no longer exists.\n"
                "- `app_abnormal_status` : App status does not allow API access.\n"
                "- `app_api_disabled` : The app's API service has been disabled.\n"
                "- `workspace_not_found` : The app's workspace no longer exists.\n"
                "- `workspace_archived` : The app's workspace is archived.\n"
                "- `app_suggested_questions_after_answer_disabled` : Suggested questions feature is disabled."
            ),
            HTTPStatus.NOT_FOUND: (
                "- `not_found` : End user, message, or conversation does not exist.\n"
                "- `agent_version_not_found_error` : Agent config version does not exist."
            ),
            HTTPStatus.INTERNAL_SERVER_ERROR: "`internal_server_error` : Internal server error.",
        },
    )
    @service_api_ns.response(
        HTTPStatus.OK,
        "Suggested questions retrieved successfully",
        service_api_ns.models[SimpleResultStringListResponse.__name__],
    )
    @service_api_ns.doc(params={"message_id": "Message ID"})
    @service_api_end_user_admission(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY, required=True))
    def get(self, context: ServiceApiEndUserContext, message_id: UUID) -> dict[str, object]:
        """Get suggested follow-up questions for a message.

        Returns an empty list when model resolution or the question-generation
        model call fails. History token-counting invocation failures return
        HTTP 400 with completion_request_error.
        """
        message_id_str = str(message_id)
        app_mode = AppMode.value_of(context.app_mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        try:
            questions = application_services().message_suggested_questions.get_suggested_questions(
                app_id=context.app_id,
                app_owner_tenant_id=context.tenant_id,
                expected_app_mode=context.app_mode,
                actor=MessageEndUser(end_user_id=context.end_user_id),
                invoke_from="service-api",
                message_id=message_id_str,
            )
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None
        except MessageActorNotFoundError:
            raise NotFoundError("End user not found") from None
        except MessageNotExistsError:
            raise NotFoundError("Message Not Exists.")
        except ConversationNotExistsError:
            raise NotFoundError("Conversation not found") from None
        except SuggestedQuestionsAfterAnswerDisabledError:
            raise AppSuggestedQuestionsAfterAnswerDisabledError() from None
        except ProviderTokenNotInitError as error:
            raise ProviderNotInitializeError(error.description) from error
        except QuotaExceededError:
            raise ProviderQuotaExceededError() from None
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError() from None
        except InvokeError as error:
            raise CompletionRequestError(error.description) from error
        except AgentVersionNotFoundError:
            # The legacy Agent config reader still owns this HTTP error.
            # Remove this compatibility case when it exposes a domain error.
            raise
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()

        return dump_response(SimpleResultStringListResponse, {"result": "success", "data": questions})
