import logging
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import InternalServerError, NotFound

import services
from controllers.common.schema import register_schema_models
from controllers.web import web_ns
from controllers.web.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    NotChatAppError,
    NotCompletionAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from controllers.web.wraps import WebApiResource
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.model_runtime.errors.invoke import InvokeError
from libs import helper
from libs.helper import uuid_value
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.app_task_service import AppTaskService
from services.errors.llm import InvokeRateLimitError

logger = logging.getLogger(__name__)


class CompletionMessagePayload(BaseModel):
    inputs: dict[str, Any] = Field(description="Input variables for the completion")
    query: str = Field(default="", description="Query text for completion")
    files: list[dict[str, Any]] | None = Field(default=None, description="Files to be processed")
    response_mode: Literal["blocking", "streaming"] | None = Field(
        default=None, description="Response mode: blocking or streaming"
    )
    retriever_from: str = Field(default="web_app", description="Source of retriever")


class ChatMessagePayload(BaseModel):
    inputs: dict[str, Any] = Field(description="Input variables for the chat")
    query: str = Field(description="User query/message")
    files: list[dict[str, Any]] | None = Field(default=None, description="Files to be processed")
    response_mode: Literal["blocking", "streaming"] | None = Field(
        default=None, description="Response mode: blocking or streaming"
    )
    conversation_id: str | None = Field(default=None, description="Conversation ID")
    parent_message_id: str | None = Field(default=None, description="Parent message ID")
    retriever_from: str = Field(default="web_app", description="Source of retriever")

    @field_validator("conversation_id", "parent_message_id")
    @classmethod
    def validate_uuid(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


register_schema_models(web_ns, CompletionMessagePayload, ChatMessagePayload)


# define completion api for user
@web_ns.route("/completion-messages")
class CompletionApi(WebApiResource):
    @web_ns.doc("Create Completion Message")
    @web_ns.doc(description="Create a completion message for text generation applications.")
    @web_ns.expect(web_ns.models[CompletionMessagePayload.__name__])
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "App Not Found",
            500: "Internal Server Error",
        }
    )
    def post(self, app_model, end_user):
        if app_model.mode != AppMode.COMPLETION:
            raise NotCompletionAppError()

        payload = CompletionMessagePayload.model_validate(web_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        streaming = payload.response_mode == "streaming"
        args["auto_generate_name"] = False

        try:
            response = AppGenerateService.generate(
                app_model=app_model, user=end_user, args=args, invoke_from=InvokeFrom.WEB_APP, streaming=streaming
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
        except Exception as e:
            logger.exception("internal server error.")
            raise InternalServerError()


@web_ns.route("/completion-messages/<string:task_id>/stop")
class CompletionStopApi(WebApiResource):
    @web_ns.doc("Stop Completion Message")
    @web_ns.doc(description="Stop a running completion message task.")
    @web_ns.doc(params={"task_id": {"description": "Task ID to stop", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Task Not Found",
            500: "Internal Server Error",
        }
    )
    def post(self, app_model, end_user, task_id):
        if app_model.mode != AppMode.COMPLETION:
            raise NotCompletionAppError()

        AppTaskService.stop_task(
            task_id=task_id,
            invoke_from=InvokeFrom.WEB_APP,
            user_id=end_user.id,
            app_mode=AppMode.value_of(app_model.mode),
        )

        return {"result": "success"}, 200


@web_ns.route("/chat-messages")
class ChatApi(WebApiResource):
    @web_ns.doc("Create Chat Message")
    @web_ns.doc(description="Create a chat message for conversational applications.")
    @web_ns.expect(web_ns.models[ChatMessagePayload.__name__])
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "App Not Found",
            500: "Internal Server Error",
        }
    )
    def post(self, app_model, end_user):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        payload = ChatMessagePayload.model_validate(web_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        streaming = payload.response_mode == "streaming"
        args["auto_generate_name"] = False

        try:
            response = AppGenerateService.generate(
                app_model=app_model, user=end_user, args=args, invoke_from=InvokeFrom.WEB_APP, streaming=streaming
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
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description)
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception as e:
            logger.exception("internal server error.")
            raise InternalServerError()


@web_ns.route("/chat-messages/<string:task_id>/stop")
class ChatStopApi(WebApiResource):
    @web_ns.doc("Stop Chat Message")
    @web_ns.doc(description="Stop a running chat message task.")
    @web_ns.doc(params={"task_id": {"description": "Task ID to stop", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Task Not Found",
            500: "Internal Server Error",
        }
    )
    def post(self, app_model, end_user, task_id):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        AppTaskService.stop_task(
            task_id=task_id,
            invoke_from=InvokeFrom.WEB_APP,
            user_id=end_user.id,
            app_mode=app_mode,
        )

        return {"result": "success"}, 200
