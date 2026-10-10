import logging
from http import HTTPStatus
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, TypeAdapter
from sqlalchemy.orm import Session

from controllers.common.controller_schemas import MessageFeedbackPayload, MessageListQuery
from controllers.common.errors import InternalServerError, NotFoundError
from controllers.common.fields import GeneratedAppResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.app.wraps import with_session
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from controllers.web.error import (
    AppMoreLikeThisDisabledError,
    AppSuggestedQuestionsAfterAnswerDisabledError,
    AppUnavailableError,
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
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from fields.conversation_fields import MessageResponseSource, ResultResponse
from fields.message_fields import SuggestedQuestionsResponse, WebMessageInfiniteScrollPagination, WebMessageListItem
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from models.enums import FeedbackRating
from models.model import App, AppMode, EndUser
from services.agent.errors import AgentVersionNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_generate_service import AppGenerateService
from services.entities.message_entities import MessageEndUser
from services.errors.app import MoreLikeThisDisabledError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageActorNotFoundError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService

logger = logging.getLogger(__name__)


class MessageMoreLikeThisQuery(BaseModel):
    response_mode: Literal["blocking", "streaming"] = Field(
        description="Response mode",
    )


register_schema_models(web_ns, MessageListQuery, MessageFeedbackPayload, MessageMoreLikeThisQuery)
register_response_schema_models(
    web_ns,
    GeneratedAppResponse,
    ResultResponse,
    SuggestedQuestionsResponse,
    WebMessageInfiniteScrollPagination,
)


@web_ns.route("/messages")
class MessageListApi(WebApiResource):
    @web_ns.doc("Get Message List")
    @web_ns.doc(description="Retrieve paginated list of messages from a conversation in a chat application.")
    @web_ns.doc(params=query_params_from_model(MessageListQuery))
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
    @web_ns.response(200, "Success", web_ns.models[WebMessageInfiniteScrollPagination.__name__])
    @model_validate(MessageListQuery)
    def get(self, query: MessageListQuery, app_model: App, end_user: EndUser):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        try:
            session = db.session()
            pagination = MessageService.pagination_by_first_id(
                app_model, end_user, query.conversation_id, query.first_id, query.limit, session=session
            )
            adapter = TypeAdapter(WebMessageListItem)
            items = [
                adapter.validate_python(MessageResponseSource(message, session=session), from_attributes=True)
                for message in pagination.data
            ]
            return WebMessageInfiniteScrollPagination(
                limit=pagination.limit,
                has_more=pagination.has_more,
                data=items,
            ).model_dump(mode="json")
        except ConversationNotExistsError:
            raise NotFoundError("Conversation Not Exists.")
        except FirstMessageNotExistsError:
            raise NotFoundError("First Message Not Exists.")


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
    @web_ns.response(200, "Feedback submitted successfully", web_ns.models[ResultResponse.__name__])
    @web_ns.expect(web_ns.models[MessageFeedbackPayload.__name__])
    @model_validate(MessageFeedbackPayload)
    def post(self, payload: MessageFeedbackPayload, app_model: App, end_user: EndUser, message_id: UUID):
        message_id_str = str(message_id)

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
            raise NotFoundError("Message Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json")


@web_ns.route("/messages/<uuid:message_id>/more-like-this")
class MessageMoreLikeThisApi(WebApiResource):
    @web_ns.doc("Generate More Like This")
    @web_ns.doc(description="Generate a new completion similar to an existing message (completion apps only).")
    @web_ns.doc(params=query_params_from_model(MessageMoreLikeThisQuery))
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
    @web_ns.response(200, "Success", web_ns.models[GeneratedAppResponse.__name__])
    @with_session
    @model_validate(MessageMoreLikeThisQuery)
    def get(
        self,
        query: MessageMoreLikeThisQuery,
        session: Session,
        app_model: App,
        end_user: EndUser,
        message_id: UUID,
    ):
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        message_id_str = str(message_id)

        streaming = query.response_mode == "streaming"

        try:
            response = AppGenerateService.generate_more_like_this(
                session=session,
                app_model=app_model,
                user=end_user,
                message_id=message_id_str,
                invoke_from=InvokeFrom.WEB_APP,
                streaming=streaming,
            )

            # response-contract:ignore compact_generate_response
            return helper.compact_generate_response(response)
        except MessageNotExistsError:
            raise NotFoundError("Message Not Exists.")
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
    @web_ns.response(HTTPStatus.OK, "Success", web_ns.models[SuggestedQuestionsResponse.__name__])
    @web_ns.doc("Get Suggested Questions")
    @web_ns.doc(
        description=(
            "Get suggested follow-up questions after a message (chat apps only). "
            "If no usable model can be resolved or the model call to generate questions fails, "
            "the response is HTTP 200 with an empty data list. "
            "Model invocation failures during history token counting instead return "
            "HTTP 400 with `completion_request_error`."
        )
    )
    @web_ns.doc(params={"message_id": {"description": "Message UUID", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            HTTPStatus.OK: "Success",
            HTTPStatus.BAD_REQUEST: (
                "Bad Request - Not a chat app or app unavailable; "
                "`completion_request_error` when model invocation fails while counting history tokens."
            ),
            HTTPStatus.UNAUTHORIZED: "Unauthorized",
            HTTPStatus.FORBIDDEN: "Forbidden - Access denied or suggested questions disabled",
            HTTPStatus.NOT_FOUND: "App, End User, Message, or Conversation Not Found",
            HTTPStatus.INTERNAL_SERVER_ERROR: "Internal Server Error",
        }
    )
    def get(self, app_model: App, end_user: EndUser, message_id: UUID) -> dict[str, object]:
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        message_id_str = str(message_id)

        try:
            questions = application_services().message_suggested_questions.get_suggested_questions(
                app_id=app_model.id,
                app_owner_tenant_id=app_model.tenant_id,
                expected_app_mode=app_model.mode,
                actor=MessageEndUser(end_user_id=end_user.id),
                invoke_from="web-app",
                message_id=message_id_str,
            )
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None
        except MessageActorNotFoundError:
            raise NotFoundError("End user not found") from None
        except MessageNotExistsError:
            raise NotFoundError("Message not found")
        except ConversationNotExistsError:
            raise NotFoundError("Conversation not found")
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
        except AgentVersionNotFoundError:
            # The legacy Agent config reader still owns this HTTP error.
            # Remove this compatibility case when it exposes a domain error.
            raise
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()

        return helper.dump_response(SuggestedQuestionsResponse, {"data": questions})
