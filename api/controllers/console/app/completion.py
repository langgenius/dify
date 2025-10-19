import logging

from flask import request
from flask_restx import Resource, fields, reqparse
from werkzeug.exceptions import InternalServerError, NotFound

import services
from controllers.console import api, console_ns
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
from libs.login import current_user, login_required
from models import Account
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.errors.llm import InvokeRateLimitError

logger = logging.getLogger(__name__)


# define completion message api for user
@console_ns.route("/apps/<uuid:app_id>/completion-messages")
class CompletionMessageApi(Resource):
    @api.doc("create_completion_message")
    @api.doc(description="Generate completion message for debugging")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "CompletionMessageRequest",
            {
                "inputs": fields.Raw(required=True, description="Input variables"),
                "query": fields.String(description="Query text", default=""),
                "files": fields.List(fields.Raw(), description="Uploaded files"),
                "model_config": fields.Raw(required=True, description="Model configuration"),
                "response_mode": fields.String(enum=["blocking", "streaming"], description="Response mode"),
                "retriever_from": fields.String(default="dev", description="Retriever source"),
            },
        )
    )
    @api.response(200, "Completion generated successfully")
    @api.response(400, "Invalid request parameters")
    @api.response(404, "App not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.COMPLETION)
    def post(self, app_model):
        parser = (
            reqparse.RequestParser()
            .add_argument("inputs", type=dict, required=True, location="json")
            .add_argument("query", type=str, location="json", default="")
            .add_argument("files", type=list, required=False, location="json")
            .add_argument("model_config", type=dict, required=True, location="json")
            .add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json")
            .add_argument("retriever_from", type=str, required=False, default="dev", location="json")
        )
        args = parser.parse_args()

        streaming = args["response_mode"] != "blocking"
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
    @api.doc("stop_completion_message")
    @api.doc(description="Stop a running completion message generation")
    @api.doc(params={"app_id": "Application ID", "task_id": "Task ID to stop"})
    @api.response(200, "Task stopped successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.COMPLETION)
    def post(self, app_model, task_id):
        if not isinstance(current_user, Account):
            raise ValueError("current_user must be an Account instance")
        AppQueueManager.set_stop_flag(task_id, InvokeFrom.DEBUGGER, current_user.id)

        return {"result": "success"}, 200


@console_ns.route("/apps/<uuid:app_id>/chat-messages")
class ChatMessageApi(Resource):
    @api.doc("create_chat_message")
    @api.doc(description="Generate chat message for debugging")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "ChatMessageRequest",
            {
                "inputs": fields.Raw(required=True, description="Input variables"),
                "query": fields.String(required=True, description="User query"),
                "files": fields.List(fields.Raw(), description="Uploaded files"),
                "model_config": fields.Raw(required=True, description="Model configuration"),
                "conversation_id": fields.String(description="Conversation ID"),
                "parent_message_id": fields.String(description="Parent message ID"),
                "response_mode": fields.String(enum=["blocking", "streaming"], description="Response mode"),
                "retriever_from": fields.String(default="dev", description="Retriever source"),
            },
        )
    )
    @api.response(200, "Chat message generated successfully")
    @api.response(400, "Invalid request parameters")
    @api.response(404, "App or conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT])
    @edit_permission_required
    def post(self, app_model):
        parser = (
            reqparse.RequestParser()
            .add_argument("inputs", type=dict, required=True, location="json")
            .add_argument("query", type=str, required=True, location="json")
            .add_argument("files", type=list, required=False, location="json")
            .add_argument("model_config", type=dict, required=True, location="json")
            .add_argument("conversation_id", type=uuid_value, location="json")
            .add_argument("parent_message_id", type=uuid_value, required=False, location="json")
            .add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json")
            .add_argument("retriever_from", type=str, required=False, default="dev", location="json")
        )
        args = parser.parse_args()

        streaming = args["response_mode"] != "blocking"
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
    @api.doc("stop_chat_message")
    @api.doc(description="Stop a running chat message generation")
    @api.doc(params={"app_id": "Application ID", "task_id": "Task ID to stop"})
    @api.response(200, "Task stopped successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    def post(self, app_model, task_id):
        if not isinstance(current_user, Account):
            raise ValueError("current_user must be an Account instance")
        AppQueueManager.set_stop_flag(task_id, InvokeFrom.DEBUGGER, current_user.id)

        return {"result": "success"}, 200
