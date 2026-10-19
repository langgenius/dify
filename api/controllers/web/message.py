import logging
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.common.controller_schemas import MessageFeedbackPayload, MessageListQuery
from controllers.common.fields import GeneratedAppResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.app.wraps import with_session
from controllers.console.wraps import model_validate
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
from extensions.ext_database import db
from fields.conversation_fields import MessageResponseSource, ResultResponse
from fields.message_fields import SuggestedQuestionsResponse, WebMessageInfiniteScrollPagination, WebMessageListItem
from graphon.enums import WorkflowExecutionStatus
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from libs.external_api import error_responses
from models.enums import CreatorUserRole, FeedbackRating
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowRun
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
    @error_responses(NotChatAppError)
    @web_ns.doc("Get Message List")
    @web_ns.doc(description="Retrieve paginated list of messages from a conversation in a chat application.")
    @web_ns.doc(params=query_params_from_model(MessageListQuery))
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
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
            running_workflow_run_ids: set[str] = set()
            if app_mode == AppMode.ADVANCED_CHAT:
                workflow_run_ids = {message.workflow_run_id for message in pagination.data if message.workflow_run_id}
                if workflow_run_ids:
                    running_workflow_run_ids = set(
                        session.scalars(
                            select(WorkflowRun.id).where(
                                WorkflowRun.id.in_(workflow_run_ids),
                                WorkflowRun.tenant_id == app_model.tenant_id,
                                WorkflowRun.app_id == app_model.id,
                                WorkflowRun.created_by_role == CreatorUserRole.END_USER,
                                WorkflowRun.created_by == end_user.id,
                                WorkflowRun.status == WorkflowExecutionStatus.RUNNING,
                            )
                        )
                    )

            items = []
            for message in pagination.data:
                item = adapter.validate_python(MessageResponseSource(message, session=session), from_attributes=True)
                items.append(
                    item.model_copy(
                        update={"workflow_run_is_running": message.workflow_run_id in running_workflow_run_ids}
                    )
                )
            return WebMessageInfiniteScrollPagination(
                limit=pagination.limit,
                has_more=pagination.has_more,
                data=items,
            ).model_dump(mode="json")
        except ConversationNotExistsError as caught_error:
            raise NotFound("Conversation Not Exists.") from caught_error
        except FirstMessageNotExistsError as caught_error:
            raise NotFound("First Message Not Exists.") from caught_error


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
        except MessageNotExistsError as caught_error:
            raise NotFound("Message Not Exists.") from caught_error

        return ResultResponse(result="success").model_dump(mode="json")


@web_ns.route("/messages/<uuid:message_id>/more-like-this")
class MessageMoreLikeThisApi(WebApiResource):
    @error_responses(
        AppMoreLikeThisDisabledError,
        CompletionRequestError,
        NotCompletionAppError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
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
        except MessageNotExistsError as caught_error:
            raise NotFound("Message Not Exists.") from caught_error
        except MoreLikeThisDisabledError as caught_error:
            raise AppMoreLikeThisDisabledError() from caught_error
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description) from ex
        except QuotaExceededError as caught_error:
            raise ProviderQuotaExceededError() from caught_error
        except ModelCurrentlyNotSupportError as caught_error:
            raise ProviderModelCurrentlyNotSupportError() from caught_error
        except InvokeError as e:
            raise CompletionRequestError(e.description) from e
        except ValueError as e:
            raise e
        except Exception as caught_error:
            logger.exception("internal server error.")
            raise InternalServerError() from caught_error


@web_ns.route("/messages/<uuid:message_id>/suggested-questions")
class MessageSuggestedQuestionApi(WebApiResource):
    @error_responses(
        AppSuggestedQuestionsAfterAnswerDisabledError,
        CompletionRequestError,
        NotChatAppError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @web_ns.response(200, "Success", web_ns.models[SuggestedQuestionsResponse.__name__])
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
    def get(self, app_model: App, end_user: EndUser, message_id: UUID):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        message_id_str = str(message_id)

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model,
                user=end_user,
                message_id=message_id_str,
                invoke_from=InvokeFrom.WEB_APP,
                session=db.session(),
            )
            # questions is a list of strings, not a list of Message objects
        except MessageNotExistsError as caught_error:
            raise NotFound("Message not found") from caught_error
        except ConversationNotExistsError as caught_error:
            raise NotFound("Conversation not found") from caught_error
        except SuggestedQuestionsAfterAnswerDisabledError as caught_error:
            raise AppSuggestedQuestionsAfterAnswerDisabledError() from caught_error
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description) from ex
        except QuotaExceededError as caught_error:
            raise ProviderQuotaExceededError() from caught_error
        except ModelCurrentlyNotSupportError as caught_error:
            raise ProviderModelCurrentlyNotSupportError() from caught_error
        except InvokeError as e:
            raise CompletionRequestError(e.description) from e
        except Exception as caught_error:
            logger.exception("internal server error.")
            raise InternalServerError() from caught_error

        return SuggestedQuestionsResponse(data=questions).model_dump(mode="json")
