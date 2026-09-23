import logging
from typing import Any, Literal
from uuid import UUID

from flask import Response
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import InternalServerError, NotFound, Unauthorized

import services
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.app.wraps import with_session
from controllers.console.explore.error import NotChatAppError, NotCompletionAppError
from controllers.console.explore.installed_app_admission import get_installed_app
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate, with_current_user
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models import Account
from models.model import AppMode, InstalledApp
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_generate_service import AppGenerateService
from services.app_task_service import AppTaskService
from services.conversation_service import ConversationService
from services.errors.llm import InvokeRateLimitError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_completion_service import InstalledAppNotCompletionError

from .. import console_ns

logger = logging.getLogger(__name__)


class CompletionMessageExplorePayload(BaseModel):
    inputs: dict[str, Any]
    query: str = ""
    files: list[dict[str, Any]] | None = Field(default=None)
    response_mode: Literal["blocking", "streaming"] | None = None
    retriever_from: str = Field(default="explore_app")


class ChatMessagePayload(BaseModel):
    inputs: dict[str, Any]
    query: str
    files: list[dict[str, Any]] | None = Field(default=None)
    conversation_id: str | None = None
    parent_message_id: str | None = None
    retriever_from: str = Field(default="explore_app")

    @field_validator("conversation_id", "parent_message_id", mode="before")
    @classmethod
    def normalize_uuid(cls, value: str | UUID | None) -> str | None:
        """
        Accept blank IDs and validate UUID format when provided.
        """
        if not value:
            return None

        try:
            return helper.uuid_value(value)
        except ValueError as exc:
            raise ValueError("must be a valid UUID") from exc


register_schema_models(console_ns, CompletionMessageExplorePayload, ChatMessagePayload)
register_response_schema_models(console_ns, SimpleResultResponse)


# define completion api for user
@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/completion-messages",
    endpoint="installed_app_completion",
)
class CompletionApi(Resource):
    @console_ns.expect(console_ns.models[CompletionMessageExplorePayload.__name__])
    @console_ns.response(200, "Success")
    @console_account_admission()
    @get_installed_app
    @model_validate(CompletionMessageExplorePayload)
    def post(
        self,
        req_data: CompletionMessageExplorePayload,
        request_context: RequestContext,
        installed_app: InstalledAppRef,
    ) -> Response:
        try:
            response = application_services().installed_app_completion.generate(
                installed_app=installed_app,
                account_id=request_context.account_id,
                args=req_data.model_dump(exclude_none=True),
            )

            # response-contract:ignore compact_generate_response
            return helper.compact_generate_response(response)
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None
        except InstalledAppNotCompletionError:
            raise NotCompletionAppError() from None
        except InstalledAppNotFoundError:
            raise NotFound("Installed app not found") from None
        except AccountNotFoundError:
            raise Unauthorized("Account no longer exists.") from None
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logger.exception("App model config broken.")
            raise AppUnavailableError()
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
    "/installed-apps/<uuid:installed_app_id>/completion-messages/<string:task_id>/stop",
    endpoint="installed_app_stop_completion",
)
class CompletionStopApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission()
    @get_installed_app
    def post(
        self, request_context: RequestContext, installed_app: InstalledAppRef, task_id: str
    ) -> tuple[dict[str, object], int]:
        try:
            app_mode = application_services().app_definitions.get_mode(installed_app.app_id)
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None
        if app_mode != AppMode.COMPLETION:
            raise NotCompletionAppError()

        AppTaskService.stop_task(
            task_id=task_id,
            invoke_from=InvokeFrom.EXPLORE,
            user_id=request_context.account_id,
            app_mode=AppMode.value_of(app_mode),
        )

        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/chat-messages",
    endpoint="installed_app_chat_completion",
)
class ChatApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[ChatMessagePayload.__name__])
    @console_ns.response(200, "Success")
    @with_current_user
    @with_session
    @model_validate(ChatMessagePayload)
    def post(self, req_data: ChatMessagePayload, session: Session, current_user: Account, installed_app: InstalledApp):
        app_model = installed_app.app_with_session(session=session)
        if app_model is None:
            raise AppUnavailableError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        args = req_data.model_dump(exclude_none=True)

        args["auto_generate_name"] = False

        installed_app.last_used_at = naive_utc_now()
        db.session.commit()

        try:
            # Eagerly validate conversation to avoid hanging on invalid conversation_id
            if req_data.conversation_id:
                ConversationService.get_conversation(
                    app_model=app_model,
                    conversation_id=req_data.conversation_id,
                    user=current_user,
                    session=session,
                )

            response = AppGenerateService.generate(
                session=session,
                app_model=app_model,
                user=current_user,
                args=args,
                invoke_from=InvokeFrom.EXPLORE,
                streaming=True,
            )

            # response-contract:ignore compact_generate_response
            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logger.exception("App model config broken.")
            raise AppUnavailableError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/chat-messages/<string:task_id>/stop",
    endpoint="installed_app_stop_chat_completion",
)
class ChatStopApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission()
    @get_installed_app
    def post(
        self, request_context: RequestContext, installed_app: InstalledAppRef, task_id: str
    ) -> tuple[dict[str, object], int]:
        try:
            mode = application_services().app_definitions.get_mode(installed_app.app_id)
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None
        app_mode = AppMode.value_of(mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        AppTaskService.stop_task(
            task_id=task_id,
            invoke_from=InvokeFrom.EXPLORE,
            user_id=request_context.account_id,
            app_mode=app_mode,
        )

        return SimpleResultResponse(result="success").model_dump(mode="json"), 200
