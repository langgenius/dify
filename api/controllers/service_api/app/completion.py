import logging
from typing import Any, Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

import services
from controllers.common.schema import register_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    NotChatAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.helper.trace_id_helper import get_external_trace_id
from core.model_runtime.errors.invoke import InvokeError
from libs import helper
from models.model import App, AppMode, EndUser
from services.app_generate_service import AppGenerateService
from services.app_task_service import AppTaskService
from services.errors.app import IsDraftWorkflowError, WorkflowIdFormatError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError

logger = logging.getLogger(__name__)


class CompletionRequestPayload(BaseModel):
    inputs: dict[str, Any]
    query: str = Field(default="")
    files: list[dict[str, Any]] | None = None
    response_mode: Literal["blocking", "streaming"] | None = None
    retriever_from: str = Field(default="dev")


class ChatRequestPayload(BaseModel):
    inputs: dict[str, Any]
    query: str
    files: list[dict[str, Any]] | None = None
    response_mode: Literal["blocking", "streaming"] | None = None
    conversation_id: str | None = Field(default=None, description="Conversation UUID")
    retriever_from: str = Field(default="dev")
    auto_generate_name: bool = Field(default=True, description="Auto generate conversation name")
    workflow_id: str | None = Field(default=None, description="Workflow ID for advanced chat")

    @field_validator("conversation_id", mode="before")
    @classmethod
    def normalize_conversation_id(cls, value: str | UUID | None) -> str | None:
        """Allow missing or blank conversation IDs; enforce UUID format when provided."""
        if isinstance(value, str):
            value = value.strip()

        if not value:
            return None

        try:
            return helper.uuid_value(value)
        except ValueError as exc:
            raise ValueError("conversation_id must be a valid UUID") from exc


register_schema_models(service_api_ns, CompletionRequestPayload, ChatRequestPayload)


@service_api_ns.route("/completion-messages")
class CompletionApi(Resource):
    @service_api_ns.expect(service_api_ns.models[CompletionRequestPayload.__name__])
    @service_api_ns.doc("create_completion")
    @service_api_ns.doc(description="Create a completion for the given prompt")
    @service_api_ns.doc(
        responses={
            200: "Completion created successfully",
            400: "Bad request - invalid parameters",
            401: "Unauthorized - invalid API token",
            404: "Conversation not found",
            500: "Internal server error",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser):
        """Create a completion for the given prompt.

        This endpoint generates a completion based on the provided inputs and query.
        Supports both blocking and streaming response modes.
        """
        if app_model.mode != AppMode.COMPLETION:
            raise AppUnavailableError()

        payload = CompletionRequestPayload.model_validate(service_api_ns.payload or {})
        external_trace_id = get_external_trace_id(request)
        args = payload.model_dump(exclude_none=True)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id

        streaming = payload.response_mode == "streaming"

        args["auto_generate_name"] = False

        try:
            response = AppGenerateService.generate(
                app_model=app_model,
                user=end_user,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
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


@service_api_ns.route("/completion-messages/<string:task_id>/stop")
class CompletionStopApi(Resource):
    @service_api_ns.doc("stop_completion")
    @service_api_ns.doc(description="Stop a running completion task")
    @service_api_ns.doc(params={"task_id": "The ID of the task to stop"})
    @service_api_ns.doc(
        responses={
            200: "Task stopped successfully",
            401: "Unauthorized - invalid API token",
            404: "Task not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser, task_id: str):
        """Stop a running completion task."""
        if app_model.mode != AppMode.COMPLETION:
            raise AppUnavailableError()

        AppTaskService.stop_task(
            task_id=task_id,
            invoke_from=InvokeFrom.SERVICE_API,
            user_id=end_user.id,
            app_mode=AppMode.value_of(app_model.mode),
        )

        return {"result": "success"}, 200


@service_api_ns.route("/chat-messages")
class ChatApi(Resource):
    @service_api_ns.expect(service_api_ns.models[ChatRequestPayload.__name__])
    @service_api_ns.doc("create_chat_message")
    @service_api_ns.doc(description="Send a message in a chat conversation")
    @service_api_ns.doc(
        responses={
            200: "Message sent successfully",
            400: "Bad request - invalid parameters or workflow issues",
            401: "Unauthorized - invalid API token",
            404: "Conversation or workflow not found",
            429: "Rate limit exceeded",
            500: "Internal server error",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser):
        """Send a message in a chat conversation.

        This endpoint handles chat messages for chat, agent chat, and advanced chat applications.
        Supports conversation management and both blocking and streaming response modes.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        payload = ChatRequestPayload.model_validate(service_api_ns.payload or {})

        external_trace_id = get_external_trace_id(request)
        args = payload.model_dump(exclude_none=True)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id

        streaming = payload.response_mode == "streaming"

        try:
            response = AppGenerateService.generate(
                app_model=app_model, user=end_user, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=streaming
            )

            return helper.compact_generate_response(response)
        except WorkflowNotFoundError as ex:
            raise NotFound(str(ex))
        except IsDraftWorkflowError as ex:
            raise BadRequest(str(ex))
        except WorkflowIdFormatError as ex:
            raise BadRequest(str(ex))
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
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@service_api_ns.route("/chat-messages/<string:task_id>/stop")
class ChatStopApi(Resource):
    @service_api_ns.doc("stop_chat_message")
    @service_api_ns.doc(description="Stop a running chat message generation")
    @service_api_ns.doc(params={"task_id": "The ID of the task to stop"})
    @service_api_ns.doc(
        responses={
            200: "Task stopped successfully",
            401: "Unauthorized - invalid API token",
            404: "Task not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser, task_id: str):
        """Stop a running chat message generation."""
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        AppTaskService.stop_task(
            task_id=task_id,
            invoke_from=InvokeFrom.SERVICE_API,
            user_id=end_user.id,
            app_mode=app_mode,
        )

        return {"result": "success"}, 200
