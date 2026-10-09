"""HTTP admission and response contracts for installed-app messages."""

import logging
from collections.abc import Callable
from functools import wraps
from http import HTTPStatus
from typing import Literal
from uuid import UUID

from flask import Response
from flask_restx import Resource
from pydantic import BaseModel

from controllers.common.controller_schemas import MessageFeedbackPayload, MessageListQuery
from controllers.common.errors import InternalServerError, MessageFeedbackRatingRequiredError, UnauthorizedError
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
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
    ConversationNotFoundHTTPError,
    InstalledAppNotFoundHTTPError,
    MessageCursorNotFoundHTTPError,
    MessageNotFoundHTTPError,
    NotChatAppError,
    NotCompletionAppError,
)
from controllers.console.explore.installed_app_admission import get_installed_app
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from extensions.ext_application_services import application_services
from fields.conversation_fields import ResultResponse
from fields.message_fields import ExploreMessageInfiniteScrollPagination, SuggestedQuestionsResponse
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from libs.exception import BaseHTTPException
from machinery.context import RequestContext
from models.enums import FeedbackRating
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.entities.message_entities import MessageAccount
from services.errors.app import MoreLikeThisDisabledError
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.base import BaseServiceError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    FeedbackRatingRequiredError,
    FirstMessageNotExistsError,
    MessageActorNotFoundError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_message_service import MessageNotChatAppError
from services.message_more_like_this_service import (
    MoreLikeThisConfigNotFoundError,
    MoreLikeThisNotCompletionError,
)

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


def _message_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except InstalledAppNotFoundError as error:
            raise InstalledAppNotFoundHTTPError() from error
        except (AppDefinitionUnavailableError, MoreLikeThisConfigNotFoundError, AppModelConfigBrokenError) as error:
            raise AppUnavailableError() from error
        except (AccountNotFoundError, MessageActorNotFoundError) as error:
            raise UnauthorizedError("Account no longer exists.") from error
        except MessageNotChatAppError as error:
            raise NotChatAppError() from error
        except MoreLikeThisNotCompletionError as error:
            raise NotCompletionAppError() from error
        except MessageNotExistsError as error:
            raise MessageNotFoundHTTPError() from error
        except FirstMessageNotExistsError as error:
            raise MessageCursorNotFoundHTTPError() from error
        except ConversationNotExistsError as error:
            raise ConversationNotFoundHTTPError() from error
        except FeedbackRatingRequiredError as error:
            raise MessageFeedbackRatingRequiredError() from error
        except MoreLikeThisDisabledError as error:
            raise AppMoreLikeThisDisabledError() from error
        except SuggestedQuestionsAfterAnswerDisabledError as error:
            raise AppSuggestedQuestionsAfterAnswerDisabledError() from error
        except ProviderTokenNotInitError as error:
            raise ProviderNotInitializeError(error.description) from error
        except QuotaExceededError as error:
            raise ProviderQuotaExceededError() from error
        except ModelCurrentlyNotSupportError as error:
            raise ProviderModelCurrentlyNotSupportError() from error
        except InvokeError as error:
            raise CompletionRequestError(error.description) from error
        except (BaseHTTPException, ValueError):
            raise
        except Exception as error:
            logger.exception("Installed-app message operation failed")
            raise InternalServerError() from error

    return decorated


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages",
    endpoint="installed_app_messages",
)
class MessageListApi(Resource):
    @console_ns.doc(params=query_params_from_model(MessageListQuery))
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[ExploreMessageInfiniteScrollPagination.__name__])
    @console_account_admission()
    @get_installed_app
    @model_validate(MessageListQuery)
    @_message_errors
    def get(
        self, query: MessageListQuery, request_context: RequestContext, installed_app: InstalledAppRef
    ) -> dict[str, object]:
        page = application_services().installed_apps.messages.get_page(
            installed_app=installed_app,
            account_id=request_context.account_id,
            conversation_id=query.conversation_id,
            first_id=query.first_id or None,
            limit=query.limit,
        )
        return helper.dump_response(ExploreMessageInfiniteScrollPagination, page)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/feedbacks",
    endpoint="installed_app_message_feedback",
)
class MessageFeedbackApi(Resource):
    @console_ns.expect(console_ns.models[MessageFeedbackPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Feedback submitted successfully", console_ns.models[ResultResponse.__name__])
    @console_account_admission()
    @get_installed_app
    @model_validate(MessageFeedbackPayload)
    @_message_errors
    def post(
        self,
        payload: MessageFeedbackPayload,
        request_context: RequestContext,
        installed_app: InstalledAppRef,
        message_id: UUID,
    ) -> dict[str, object]:
        application_services().message_feedbacks.set_feedback(
            app_id=installed_app.app_id,
            app_owner_tenant_id=installed_app.app_owner_tenant_id,
            actor=MessageAccount(account_id=request_context.account_id),
            installed_app=installed_app,
            message_id=str(message_id),
            rating=FeedbackRating(payload.rating) if payload.rating is not None else None,
            content=payload.content,
        )
        return helper.dump_response(ResultResponse, {"result": "success"})


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/more-like-this",
    endpoint="installed_app_more_like_this",
)
class MessageMoreLikeThisApi(Resource):
    @console_ns.doc(params=query_params_from_model(MoreLikeThisQuery))
    @console_ns.response(HTTPStatus.OK, "Success")
    @console_account_admission()
    @get_installed_app
    @model_validate(MoreLikeThisQuery)
    @_message_errors
    def get(
        self,
        query: MoreLikeThisQuery,
        request_context: RequestContext,
        installed_app: InstalledAppRef,
        message_id: UUID,
    ) -> Response:
        if installed_app.app_mode != "completion":
            raise NotCompletionAppError()
        response = application_services().message_more_like_this.generate(
            app_id=installed_app.app_id,
            app_owner_tenant_id=installed_app.app_owner_tenant_id,
            actor=MessageAccount(account_id=request_context.account_id),
            message_id=str(message_id),
            streaming=query.response_mode == "streaming",
        )
        # response-contract:ignore compact_generate_response
        return helper.compact_generate_response(response)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/suggested-questions",
    endpoint="installed_app_suggested_question",
)
class MessageSuggestedQuestionApi(Resource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SuggestedQuestionsResponse.__name__])
    @console_account_admission()
    @get_installed_app
    @_message_errors
    def get(
        self, request_context: RequestContext, installed_app: InstalledAppRef, message_id: UUID
    ) -> dict[str, object]:
        if installed_app.app_mode not in {"chat", "agent-chat", "advanced-chat"}:
            raise NotChatAppError()

        try:
            questions = application_services().message_suggested_questions.get_suggested_questions(
                app_id=installed_app.app_id,
                app_owner_tenant_id=installed_app.app_owner_tenant_id,
                expected_app_mode=installed_app.app_mode,
                actor=MessageAccount(account_id=request_context.account_id),
                invoke_from="explore",
                message_id=str(message_id),
            )
        except (
            BaseServiceError,
            AppDefinitionUnavailableError,
            ProviderTokenNotInitError,
            QuotaExceededError,
            ModelCurrentlyNotSupportError,
            InvokeError,
        ):
            raise
        except ValueError as error:
            # Legacy model/history configuration failures are server failures,
            # not invalid request parameters. Replace this when that runtime
            # exposes typed configuration errors.
            logger.exception("Suggested-question runtime failed for message %s", message_id)
            raise InternalServerError() from error
        return helper.dump_response(SuggestedQuestionsResponse, {"data": questions})
