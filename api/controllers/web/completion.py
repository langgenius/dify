import logging
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any, Literal
from uuid import UUID

from dify_agent.protocol import RunInputRequest, RunInputText
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Conflict, InternalServerError, NotFound, ServiceUnavailable

import services
from controllers.common.fields import GeneratedAppResponse, SimpleResultResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.app.wraps import with_session
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from controllers.web.error import (
    AgentNotPublishedError,
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
from core.app.apps.agent_app.errors import AgentAppNotPublishedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from fields.base import ResponseModel
from graphon.model_runtime.errors.invoke import InvokeError
from libs import helper
from libs.external_api import error_responses
from libs.helper import dump_response, uuid_value
from models.model import App, AppMode, EndUser
from services.agent.chat_steering import (
    AgentChatBackendUnavailableError,
    AgentChatInputConflictError,
    AgentChatTaskNotFoundError,
    AgentChatTaskScope,
    enqueue_agent_chat_input,
    interrupt_agent_chat_input,
)
from services.app_generate_service import AppGenerateService
from services.app_task_service import AppTaskService
from services.conversation_service import ConversationService
from services.errors.llm import InvokeRateLimitError

logger = logging.getLogger(__name__)


def _resolve_agent_app_streaming(*, app_mode: AppMode, response_mode: str | None) -> bool:
    """Agent App runtime is SSE-only until backend blocking runs are supported."""
    if app_mode != AppMode.AGENT:
        return response_mode == "streaming"
    if response_mode == "blocking":
        raise BadRequest("Agent App only supports streaming response mode.")
    return True


class CompletionMessagePayload(BaseModel):
    inputs: dict[str, Any] = Field(
        description="Input variables for the completion",
    )
    query: str = Field(default="", description="Query text for completion")
    files: list[dict[str, Any]] | None = Field(
        default=None,
        description="Files to be processed",
    )
    response_mode: Literal["blocking", "streaming"] | None = Field(
        default=None, description="Response mode: blocking or streaming"
    )
    retriever_from: str = Field(default="web_app", description="Source of retriever")


class ChatMessagePayload(BaseModel):
    inputs: dict[str, Any] = Field(
        description="Input variables for the chat",
    )
    query: str = Field(description="User query/message")
    files: list[dict[str, Any]] | None = Field(
        default=None,
        description="Files to be processed",
    )
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


class WebAgentChatInputResponse(ResponseModel):
    """Receipt for an accepted steering input; acceptance is not delivery."""

    input_id: UUID
    status: Literal["queued"]


class WebAgentChatHandoffResponse(ResponseModel):
    """Settled steering handoff: pending inputs to replay on the next turn."""

    input_id: UUID
    pending_inputs: list[RunInputRequest]


@contextmanager
def _web_agent_steering_errors(unavailable: str) -> Generator[None]:
    """Map scoped steering failures to the published Web API contract."""
    try:
        yield
    except AgentChatTaskNotFoundError:
        raise NotFound("Agent chat task not found.") from None
    except AgentChatInputConflictError:
        raise Conflict("This Agent run is not accepting this input.") from None
    except AgentChatBackendUnavailableError:
        raise ServiceUnavailable(unavailable) from None


def _web_agent_steering_scope(app_model: App, end_user: EndUser, task_id: UUID) -> AgentChatTaskScope:
    """Derive the steering binding for a published roster Agent Web App chat.

    Only AGENT apps can own a binding; the run itself was bound server-side
    when the opted-in Web App run registered its backend run id.
    """
    if AppMode.value_of(app_model.mode) != AppMode.AGENT:
        raise NotFound("Agent chat task not found.")
    return AgentChatTaskScope(
        app_model.tenant_id, app_model.id, end_user.id, task_id, invoke_from=InvokeFrom.WEB_APP
    )


register_schema_models(web_ns, CompletionMessagePayload, ChatMessagePayload, RunInputRequest, RunInputText)
register_response_schema_models(
    web_ns,
    GeneratedAppResponse,
    SimpleResultResponse,
    WebAgentChatInputResponse,
    WebAgentChatHandoffResponse,
)


# define completion api for user
@web_ns.route("/completion-messages")
class CompletionApi(WebApiResource):
    @error_responses(
        AppUnavailableError,
        CompletionRequestError,
        NotCompletionAppError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @web_ns.doc("Create Completion Message")
    @web_ns.doc(description="Create a completion message for text generation applications.")
    @web_ns.expect(web_ns.models[CompletionMessagePayload.__name__])
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            404: "App Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[GeneratedAppResponse.__name__])
    @with_session
    def post(self, session: Session, app_model: App, end_user: EndUser):
        if app_model.mode != AppMode.COMPLETION:
            raise NotCompletionAppError()

        payload = CompletionMessagePayload.model_validate(web_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        streaming = payload.response_mode == "streaming"
        args["auto_generate_name"] = False

        try:
            response = AppGenerateService.generate(
                session=session,
                app_model=app_model,
                user=end_user,
                args=args,
                invoke_from=InvokeFrom.WEB_APP,
                streaming=streaming,
            )

            # response-contract:ignore compact_generate_response
            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError as caught_error:
            raise NotFound("Conversation Not Exists.") from caught_error
        except services.errors.conversation.ConversationCompletedError as caught_error:
            raise ConversationCompletedError() from caught_error
        except services.errors.app_model_config.AppModelConfigBrokenError as caught_error:
            logger.exception("App model config broken.")
            raise AppUnavailableError() from caught_error
        except AgentAppNotPublishedError as caught_error:
            raise AgentNotPublishedError() from caught_error
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
        except Exception as e:
            logger.exception("internal server error.")
            raise InternalServerError() from e


@web_ns.route("/completion-messages/<string:task_id>/stop")
class CompletionStopApi(WebApiResource):
    @error_responses(NotCompletionAppError)
    @web_ns.doc("Stop Completion Message")
    @web_ns.doc(description="Stop a running completion message task.")
    @web_ns.doc(params={"task_id": {"description": "Task ID to stop", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            404: "Task Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[SimpleResultResponse.__name__])
    def post(self, app_model: App, end_user: EndUser, task_id: str):
        if app_model.mode != AppMode.COMPLETION:
            raise NotCompletionAppError()

        AppTaskService.stop_task(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            task_id=task_id,
            invoke_from=InvokeFrom.WEB_APP,
            user_id=end_user.id,
            app_mode=AppMode.value_of(app_model.mode),
        )

        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@web_ns.route("/chat-messages")
class ChatApi(WebApiResource):
    @error_responses(
        AgentNotPublishedError,
        AppUnavailableError,
        CompletionRequestError,
        InvokeRateLimitHttpError,
        NotChatAppError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @web_ns.doc("Create Chat Message")
    @web_ns.doc(description="Create a chat message for conversational applications.")
    @web_ns.expect(web_ns.models[ChatMessagePayload.__name__])
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            404: "App Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[GeneratedAppResponse.__name__])
    @with_session
    def post(self, session: Session, app_model: App, end_user: EndUser):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        payload = ChatMessagePayload.model_validate(web_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        streaming = _resolve_agent_app_streaming(app_mode=app_mode, response_mode=payload.response_mode)
        args["auto_generate_name"] = False

        try:
            # Eagerly validate conversation to avoid hanging on invalid conversation_id
            if payload.conversation_id:
                ConversationService.get_conversation(
                    app_model=app_model,
                    conversation_id=payload.conversation_id,
                    user=end_user,
                    session=session,
                )

            response = AppGenerateService.generate(
                session=session,
                app_model=app_model,
                user=end_user,
                args=args,
                invoke_from=InvokeFrom.WEB_APP,
                streaming=streaming,
            )

            # response-contract:ignore compact_generate_response
            return helper.compact_generate_response(response)
        except services.errors.conversation.ConversationNotExistsError as caught_error:
            raise NotFound("Conversation Not Exists.") from caught_error
        except services.errors.conversation.ConversationCompletedError as caught_error:
            raise ConversationCompletedError() from caught_error
        except services.errors.app_model_config.AppModelConfigBrokenError as caught_error:
            logger.exception("App model config broken.")
            raise AppUnavailableError() from caught_error
        except AgentAppNotPublishedError as caught_error:
            raise AgentNotPublishedError() from caught_error
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description) from ex
        except QuotaExceededError as caught_error:
            raise ProviderQuotaExceededError() from caught_error
        except ModelCurrentlyNotSupportError as caught_error:
            raise ProviderModelCurrentlyNotSupportError() from caught_error
        except InvokeRateLimitError as ex:
            raise InvokeRateLimitHttpError(ex.description) from ex
        except InvokeError as e:
            raise CompletionRequestError(e.description) from e
        except ValueError as e:
            raise e
        except Exception as e:
            logger.exception("internal server error.")
            raise InternalServerError() from e


@web_ns.route("/chat-messages/<string:task_id>/stop")
class ChatStopApi(WebApiResource):
    @error_responses(NotChatAppError)
    @web_ns.doc("Stop Chat Message")
    @web_ns.doc(description="Stop a running chat message task.")
    @web_ns.doc(params={"task_id": {"description": "Task ID to stop", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            404: "Task Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[SimpleResultResponse.__name__])
    def post(self, app_model: App, end_user: EndUser, task_id: str):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        AppTaskService.stop_task(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            task_id=task_id,
            invoke_from=InvokeFrom.WEB_APP,
            user_id=end_user.id,
            app_mode=app_mode,
        )

        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@web_ns.route("/chat-messages/<uuid:task_id>/inputs")
class WebAgentChatInputApi(WebApiResource):
    @web_ns.doc("enqueue_web_agent_chat_input")
    @web_ns.doc(description="Queue a steering input on an admitted Agent App web run")
    @web_ns.doc(params={"task_id": "Task ID"})
    @web_ns.expect(web_ns.models[RunInputRequest.__name__])
    @web_ns.response(202, "Input queued", web_ns.models[WebAgentChatInputResponse.__name__])
    @web_ns.response(404, "Task or opted-in web run not found")
    @web_ns.response(409, "Run is not accepting this input")
    @web_ns.response(503, "Agent backend unavailable")
    @model_validate(RunInputRequest)
    def post(
        self,
        payload: RunInputRequest,
        app_model: App,
        end_user: EndUser,
        task_id: UUID,
    ) -> tuple[dict[str, object], int]:
        scope = _web_agent_steering_scope(app_model, end_user, task_id)
        with _web_agent_steering_errors("Agent chat queue is unavailable."):
            result = enqueue_agent_chat_input(scope, payload)
        return dump_response(WebAgentChatInputResponse, result), 202


@web_ns.route("/chat-messages/<uuid:task_id>/inputs/<uuid:input_id>/interrupt")
class WebAgentChatInterruptApi(WebApiResource):
    @web_ns.doc("interrupt_web_agent_chat_input")
    @web_ns.doc(
        description="Prioritize a steering input, stop the run, and replay pending inputs on the next turn"
    )
    @web_ns.doc(params={"task_id": "Task ID", "input_id": "Input ID"})
    @web_ns.expect(web_ns.models[RunInputText.__name__])
    @web_ns.response(200, "Handoff settled", web_ns.models[WebAgentChatHandoffResponse.__name__])
    @web_ns.response(404, "Task or opted-in web run not found")
    @web_ns.response(409, "Input cannot be handed off")
    @web_ns.response(503, "Agent backend unavailable")
    @model_validate(RunInputText)
    def post(
        self,
        payload: RunInputText,
        app_model: App,
        end_user: EndUser,
        task_id: UUID,
        input_id: UUID,
    ) -> tuple[dict[str, object], int]:
        scope = _web_agent_steering_scope(app_model, end_user, task_id)
        with _web_agent_steering_errors("Agent chat turn could not be handed off."):
            result = interrupt_agent_chat_input(
                scope, RunInputRequest(input_id=input_id, text=payload.text)
            )
        return dump_response(WebAgentChatHandoffResponse, result), 200
