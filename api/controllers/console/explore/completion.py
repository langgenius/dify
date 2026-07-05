import logging
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import InternalServerError, NotFound

import services
from controllers.common.fields import GeneratedAppResponse, SimpleResultResponse
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
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.wraps import with_current_user, with_current_user_id
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from extensions.ext_database import db
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from libs.datetime_utils import naive_utc_now
from models import Account
from models.model import AppMode, InstalledApp
from services.app_generate_service import AppGenerateService
from services.app_task_service import AppTaskService
from services.errors.llm import InvokeRateLimitError

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
register_response_schema_models(console_ns, GeneratedAppResponse, SimpleResultResponse)


# define completion api for user
@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/completion-messages",
    endpoint="installed_app_completion",
)
class CompletionApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[CompletionMessageExplorePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[GeneratedAppResponse.__name__])
    @with_current_user
    @with_session
    def post(self, session: Session, current_user: Account, installed_app: InstalledApp):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()
        if app_model.mode != AppMode.COMPLETION:
            raise NotCompletionAppError()

        payload = CompletionMessageExplorePayload.model_validate(console_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        streaming = payload.response_mode == "streaming"
        args["auto_generate_name"] = False

        installed_app.last_used_at = naive_utc_now()
        db.session.commit()

        try:
            response = AppGenerateService.generate(
                session=session,
                app_model=app_model,
                user=current_user,
                args=args,
                invoke_from=InvokeFrom.EXPLORE,
                streaming=streaming,
            )

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
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/completion-messages/<string:task_id>/stop",
    endpoint="installed_app_stop_completion",
)
class CompletionStopApi(InstalledAppResource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @with_current_user_id
    def post(self, current_user_id: str, installed_app: InstalledApp, task_id: str):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()
        if app_model.mode != AppMode.COMPLETION:
            raise NotCompletionAppError()

        AppTaskService.stop_task(
            task_id=task_id,
            invoke_from=InvokeFrom.EXPLORE,
            user_id=current_user_id,
            app_mode=AppMode.value_of(app_model.mode),
        )

        return {"result": "success"}, 200


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/chat-messages",
    endpoint="installed_app_chat_completion",
)
class ChatApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[ChatMessagePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[GeneratedAppResponse.__name__])
    @with_current_user
    @with_session
    def post(self, session: Session, current_user: Account, installed_app: InstalledApp):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        payload = ChatMessagePayload.model_validate(console_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        args["auto_generate_name"] = False

        installed_app.last_used_at = naive_utc_now()
        db.session.commit()

        try:
            response = AppGenerateService.generate(
                session=session,
                app_model=app_model,
                user=current_user,
                args=args,
                invoke_from=InvokeFrom.EXPLORE,
                streaming=True,
            )

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
class ChatStopApi(InstalledAppResource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @with_current_user_id
    def post(self, current_user_id: str, installed_app: InstalledApp, task_id: str):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        AppTaskService.stop_task(
            task_id=task_id,
            invoke_from=InvokeFrom.EXPLORE,
            user_id=current_user_id,
            app_mode=app_mode,
        )

        return {"result": "success"}, 200
