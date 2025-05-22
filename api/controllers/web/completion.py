import logging

from flask_restful import Resource, reqparse
from pydantic import ValidationError
from werkzeug.exceptions import InternalServerError, NotFound

import services
from controllers.web import api
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
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.mcp.server.handler import MCPServerReuqestHandler
from core.mcp.types import ClientRequest
from core.model_runtime.errors.invoke import InvokeError
from extensions.ext_database import db
from libs import helper
from libs.helper import uuid_value
from models.model import App, AppMCPServer, AppMode
from services.app_generate_service import AppGenerateService
from services.errors.llm import InvokeRateLimitError


# define completion api for user
class CompletionApi(WebApiResource):
    def post(self, app_model, end_user):
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, location="json")
        parser.add_argument("query", type=str, location="json", default="")
        parser.add_argument("files", type=list, required=False, location="json")
        parser.add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json")
        parser.add_argument("retriever_from", type=str, required=False, default="web_app", location="json")

        args = parser.parse_args()

        streaming = args["response_mode"] == "streaming"
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
            logging.exception("App model config broken.")
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
            logging.exception("internal server error.")
            raise InternalServerError()


class CompletionStopApi(WebApiResource):
    def post(self, app_model, end_user, task_id):
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        AppQueueManager.set_stop_flag(task_id, InvokeFrom.WEB_APP, end_user.id)

        return {"result": "success"}, 200


class ChatApi(WebApiResource):
    def post(self, app_model, end_user):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, location="json")
        parser.add_argument("query", type=str, required=True, location="json")
        parser.add_argument("files", type=list, required=False, location="json")
        parser.add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json")
        parser.add_argument("conversation_id", type=uuid_value, location="json")
        parser.add_argument("parent_message_id", type=uuid_value, required=False, location="json")
        parser.add_argument("retriever_from", type=str, required=False, default="web_app", location="json")

        args = parser.parse_args()

        streaming = args["response_mode"] == "streaming"
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
            logging.exception("App model config broken.")
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
            logging.exception("internal server error.")
            raise InternalServerError()


class ChatStopApi(WebApiResource):
    def post(self, app_model, end_user, task_id):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        AppQueueManager.set_stop_flag(task_id, InvokeFrom.WEB_APP, end_user.id)

        return {"result": "success"}, 200


class ChatMCPApi(Resource):
    def post(self, server_code):
        def int_or_str(value):
            if isinstance(value, int):
                return value
            elif isinstance(value, str):
                return int(value)
            else:
                raise ValueError("Invalid id")

        parser = reqparse.RequestParser()
        parser.add_argument("jsonrpc", type=str, required=True, location="json")
        parser.add_argument("method", type=str, required=True, location="json")
        parser.add_argument("params", type=dict, required=True, location="json")
        parser.add_argument("id", type=int_or_str, required=True, location="json")
        args = parser.parse_args()
        server = db.session.query(AppMCPServer).filter(AppMCPServer.server_code == server_code).first()
        if not server:
            raise NotFound("Server Not Found")
        app = db.session.query(App).filter(App.id == server.app_id).first()
        if not app:
            raise NotFound("App Not Found")
        try:
            request = ClientRequest.model_validate(args)
        except ValidationError as e:
            raise ValueError(f"Invalid MCP request: {str(e)}")
        mcp_server_handler = MCPServerReuqestHandler(app, request)
        return helper.compact_generate_response(mcp_server_handler.handle())


api.add_resource(CompletionApi, "/completion-messages")
api.add_resource(CompletionStopApi, "/completion-messages/<string:task_id>/stop")
api.add_resource(ChatApi, "/chat-messages")
api.add_resource(ChatMCPApi, "/server/<string:server_code>/mcp")
api.add_resource(ChatStopApi, "/chat-messages/<string:task_id>/stop")
