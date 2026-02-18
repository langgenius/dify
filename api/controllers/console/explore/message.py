import logging
from typing import Literal

from flask import request
from pydantic import BaseModel, Field, TypeAdapter
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.common.schema import register_schema_models
from controllers.console.app.error import (
    AppMoreLikeThisDisabledError,
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
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from fields.conversation_fields import ResultResponse
from fields.message_fields import MessageInfiniteScrollPagination, MessageListItem, SuggestedQuestionsResponse
from libs import helper
from libs.helper import UUIDStrOrEmpty
from libs.login import current_account_with_tenant
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

from .. import console_ns

logger = logging.getLogger(__name__)


class MessageListQuery(BaseModel):
    conversation_id: UUIDStrOrEmpty
    first_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)


class MessageFeedbackPayload(BaseModel):
    rating: Literal["like", "dislike"] | None = None
    content: str | None = None


class MoreLikeThisQuery(BaseModel):
    response_mode: Literal["blocking", "streaming"]


register_schema_models(console_ns, MessageListQuery, MessageFeedbackPayload, MoreLikeThisQuery)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages",
    endpoint="installed_app_messages",
)
class MessageListApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[MessageListQuery.__name__])
    def get(self, installed_app):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app

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
            adapter = TypeAdapter(MessageListItem)
            items = [adapter.validate_python(message, from_attributes=True) for message in pagination.data]
            return MessageInfiniteScrollPagination(
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
    def post(self, installed_app, message_id):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app

        message_id = str(message_id)

        payload = MessageFeedbackPayload.model_validate(console_ns.payload or {})

        try:
            MessageService.create_feedback(
                app_model=app_model,
                message_id=message_id,
                user=current_user,
                rating=payload.rating,
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
    @console_ns.expect(console_ns.models[MoreLikeThisQuery.__name__])
    def get(self, installed_app, message_id):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        message_id = str(message_id)

        args = MoreLikeThisQuery.model_validate(request.args.to_dict())

        streaming = args.response_mode == "streaming"

        try:
            response = AppGenerateService.generate_more_like_this(
                app_model=app_model,
                user=current_user,
                message_id=message_id,
                invoke_from=InvokeFrom.EXPLORE,
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


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/suggested-questions",
    endpoint="installed_app_suggested_question",
)
class MessageSuggestedQuestionApi(InstalledAppResource):
    def get(self, installed_app, message_id):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        message_id = str(message_id)

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model, user=current_user, message_id=message_id, invoke_from=InvokeFrom.EXPLORE
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
