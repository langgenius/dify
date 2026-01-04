import logging
from typing import Any, Literal

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import InternalServerError, NotFound

import services
from controllers.console import console_ns
from controllers.console.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
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
from libs.helper import uuid_value
from libs.login import current_user, login_required
from models import Account
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.app_task_service import AppTaskService
from services.errors.llm import InvokeRateLimitError

logger = logging.getLogger(__name__)
DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class BaseMessagePayload(BaseModel):
    inputs: dict[str, Any]
    model_config_data: dict[str, Any] = Field(..., alias="model_config")
    files: list[Any] | None = Field(default=None, description="Uploaded files")
    response_mode: Literal["blocking", "streaming"] = Field(default="blocking", description="Response mode")
    retriever_from: str = Field(default="dev", description="Retriever source")


class CompletionMessagePayload(BaseMessagePayload):
    query: str = Field(default="", description="Query text")


class ChatMessagePayload(BaseMessagePayload):
    query: str = Field(..., description="User query")
    conversation_id: str | None = Field(default=None, description="Conversation ID")
    parent_message_id: str | None = Field(default=None, description="Parent message ID")

    @field_validator("conversation_id", "parent_message_id")
    @classmethod
    def validate_uuid(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


console_ns.schema_model(
    CompletionMessagePayload.__name__,
    CompletionMessagePayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)
console_ns.schema_model(
    ChatMessagePayload.__name__, ChatMessagePayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
)


# define completion message api for user
@console_ns.route("/apps/<uuid:app_id>/completion-messages")
class CompletionMessageApi(Resource):
    @console_ns.doc("create_completion_message")
    @console_ns.doc(description="Generate completion message for debugging")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[CompletionMessagePayload.__name__])
    @console_ns.response(200, "Completion generated successfully")
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(404, "App not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.COMPLETION)
    def post(self, app_model):
        args_model = CompletionMessagePayload.model_validate(console_ns.payload)
        args = args_model.model_dump(exclude_none=True, by_alias=True)

        streaming = args_model.response_mode != "blocking"
        args["auto_generate_name"] = False

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account or EndUser instance")
            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.DEBUGGER, streaming=streaming
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


@console_ns.route("/apps/<uuid:app_id>/completion-messages/<string:task_id>/stop")
class CompletionMessageStopApi(Resource):
    @console_ns.doc("stop_completion_message")
    @console_ns.doc(description="Stop a running completion message generation")
    @console_ns.doc(params={"app_id": "Application ID", "task_id": "Task ID to stop"})
    @console_ns.response(200, "Task stopped successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.COMPLETION)
    def post(self, app_model, task_id):
        if not isinstance(current_user, Account):
            raise ValueError("current_user must be an Account instance")

        AppTaskService.stop_task(
            task_id=task_id,
            invoke_from=InvokeFrom.DEBUGGER,
            user_id=current_user.id,
            app_mode=AppMode.value_of(app_model.mode),
        )

        return {"result": "success"}, 200


@console_ns.route("/apps/<uuid:app_id>/chat-messages")
class ChatMessageApi(Resource):
    @console_ns.doc("create_chat_message")
    @console_ns.doc(description="Generate chat message for debugging")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[ChatMessagePayload.__name__])
    @console_ns.response(200, "Chat message generated successfully")
    @console_ns.response(400, "Invalid request parameters")
    @console_ns.response(404, "App or conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT])
    @edit_permission_required
    def post(self, app_model):
        args_model = ChatMessagePayload.model_validate(console_ns.payload)
        args = args_model.model_dump(exclude_none=True, by_alias=True)

        streaming = args_model.response_mode != "blocking"
        args["auto_generate_name"] = False

        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account or EndUser instance")
            response = AppGenerateService.generate(
                app_model=app_model, user=current_user, args=args, invoke_from=InvokeFrom.DEBUGGER, streaming=streaming
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


@console_ns.route("/apps/<uuid:app_id>/chat-messages/<string:task_id>/stop")
class ChatMessageStopApi(Resource):
    @console_ns.doc("stop_chat_message")
    @console_ns.doc(description="Stop a running chat message generation")
    @console_ns.doc(params={"app_id": "Application ID", "task_id": "Task ID to stop"})
    @console_ns.response(200, "Task stopped successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    def post(self, app_model, task_id):
        if not isinstance(current_user, Account):
            raise ValueError("current_user must be an Account instance")

        AppTaskService.stop_task(
            task_id=task_id,
            invoke_from=InvokeFrom.DEBUGGER,
            user_id=current_user.id,
            app_mode=AppMode.value_of(app_model.mode),
        )

        return {"result": "success"}, 200
