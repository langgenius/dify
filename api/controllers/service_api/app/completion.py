import logging

from flask import request
from flask_restx import Resource, reqparse
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

import services
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
from core.app.apps.base_app_queue_manager import AppQueueManager
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
from models.model import App, AppMode, EndUser
from services.app_generate_service import AppGenerateService
from services.errors.app import IsDraftWorkflowError, WorkflowIdFormatError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError

logger = logging.getLogger(__name__)


# Define parser for completion API
completion_parser = (
    reqparse.RequestParser()
    .add_argument("inputs", type=dict, required=True, location="json", help="Input parameters for completion")
    .add_argument("query", type=str, location="json", default="", help="The query string")
    .add_argument("files", type=list, required=False, location="json", help="List of file attachments")
    .add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json", help="Response mode")
    .add_argument("retriever_from", type=str, required=False, default="dev", location="json", help="Retriever source")
)

# Define parser for chat API
chat_parser = (
    reqparse.RequestParser()
    .add_argument("inputs", type=dict, required=True, location="json", help="Input parameters for chat")
    .add_argument("query", type=str, required=True, location="json", help="The chat query")
    .add_argument("files", type=list, required=False, location="json", help="List of file attachments")
    .add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json", help="Response mode")
    .add_argument("conversation_id", type=uuid_value, location="json", help="Existing conversation ID")
    .add_argument("retriever_from", type=str, required=False, default="dev", location="json", help="Retriever source")
    .add_argument(
        "auto_generate_name",
        type=bool,
        required=False,
        default=True,
        location="json",
        help="Auto generate conversation name",
    )
    .add_argument("workflow_id", type=str, required=False, location="json", help="Workflow ID for advanced chat")
)


@service_api_ns.route("/completion-messages")
class CompletionApi(Resource):
    @service_api_ns.expect(completion_parser)
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
        if app_model.mode != "completion":
            raise AppUnavailableError()

        args = completion_parser.parse_args()
        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id

        streaming = args["response_mode"] == "streaming"

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
        if app_model.mode != "completion":
            raise AppUnavailableError()

        AppQueueManager.set_stop_flag(task_id, InvokeFrom.SERVICE_API, end_user.id)

        return {"result": "success"}, 200


@service_api_ns.route("/chat-messages")
class ChatApi(Resource):
    @service_api_ns.expect(chat_parser)
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

        args = chat_parser.parse_args()

        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id

        streaming = args["response_mode"] == "streaming"

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

        AppQueueManager.set_stop_flag(task_id, InvokeFrom.SERVICE_API, end_user.id)

        return {"result": "success"}, 200
