import logging
from typing import Literal
from uuid import UUID

from flask import request
from pydantic import BaseModel, TypeAdapter
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.common.controller_schemas import MessageFeedbackPayload, MessageListQuery
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.app.error import (
    AppMoreLikeThisDisabledError,
    AppUnavailableError,
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.explore.error import (
    AppSuggestedQuestionsAfterAnswerDisabledError,
    NotChatAppError,
    NotCompletionAppError,
)
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.wraps import with_current_user
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from fields.conversation_fields import ResultResponse
from fields.message_fields import (
    ExploreMessageInfiniteScrollPagination,
    ExploreMessageListItem,
    SuggestedQuestionsResponse,
)
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from models import Account
from models.enums import FeedbackRating
from models.model import AppMode, InstalledApp
from services.app_generate_service import AppGenerateService
from services.errors.app import MoreLikeThisDisabledError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService

from .. import console_ns

logger = logging.getLogger(__name__)


class MoreLikeThisQuery(BaseModel):
    response_mode: Literal["blocking", "streaming"]


register_schema_models(console_ns, MessageListQuery, MessageFeedbackPayload, MoreLikeThisQuery)
register_response_schema_models(
    console_ns,
    ExploreMessageInfiniteScrollPagination,
    ResultResponse,
    SuggestedQuestionsResponse,
)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages",
    endpoint="installed_app_messages",
)
class MessageListApi(InstalledAppResource):
    @console_ns.doc(params=query_params_from_model(MessageListQuery))
    @console_ns.response(200, "Success", console_ns.models[ExploreMessageInfiniteScrollPagination.__name__])
    @with_current_user
    def get(self, current_user: Account, installed_app: InstalledApp):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()

        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()
        args = MessageListQuery.model_validate(request.args.to_dict())

        try:
            pagination = MessageService.pagination_by_first_id(
                app_model,
                current_user,
                str(args.conversation_id),
                str(args.first_id) if args.first_id else None,
                args.limit,
            )
            adapter = TypeAdapter(ExploreMessageListItem)
            items = [adapter.validate_python(message, from_attributes=True) for message in pagination.data]
            return ExploreMessageInfiniteScrollPagination(
                limit=pagination.limit,
                has_more=pagination.has_more,
                data=items,
            ).model_dump(mode="json")
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/feedbacks",
    endpoint="installed_app_message_feedback",
)
class MessageFeedbackApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[MessageFeedbackPayload.__name__])
    @console_ns.response(200, "Feedback submitted successfully", console_ns.models[ResultResponse.__name__])
    @with_current_user
    def post(self, current_user: Account, installed_app: InstalledApp, message_id: UUID):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()

        message_id_str = str(message_id)

        payload = MessageFeedbackPayload.model_validate(console_ns.payload or {})

        try:
            MessageService.create_feedback(
                app_model=app_model,
                message_id=message_id_str,
                user=current_user,
                rating=FeedbackRating(payload.rating) if payload.rating else None,
                content=payload.content,
            )
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/more-like-this",
    endpoint="installed_app_more_like_this",
)
class MessageMoreLikeThisApi(InstalledAppResource):
    @console_ns.doc(params=query_params_from_model(MoreLikeThisQuery))
    @console_ns.response(200, "Success")
    @with_current_user
    def get(self, current_user: Account, installed_app: InstalledApp, message_id: UUID):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        message_id_str = str(message_id)

        args = MoreLikeThisQuery.model_validate(request.args.to_dict())

        streaming = args.response_mode == "streaming"

        try:
            response = AppGenerateService.generate_more_like_this(
                app_model=app_model,
                user=current_user,
                message_id=message_id_str,
                invoke_from=InvokeFrom.EXPLORE,
                streaming=streaming,
            )
            # response-contract:ignore compact_generate_response
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


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/suggested-questions",
    endpoint="installed_app_suggested_question",
)
class MessageSuggestedQuestionApi(InstalledAppResource):
    @console_ns.response(200, "Success", console_ns.models[SuggestedQuestionsResponse.__name__])
    @with_current_user
    def get(self, current_user: Account, installed_app: InstalledApp, message_id: UUID):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        message_id_str = str(message_id)

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model, user=current_user, message_id=message_id_str, invoke_from=InvokeFrom.EXPLORE
            )
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
