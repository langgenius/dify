import logging

import services
from controllers.service_api_with_auth import api
from controllers.service_api_with_auth.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    NotChatAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api_with_auth.wraps import FetchUserArg, WhereisUserArg, validate_user_token_and_extract_info
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from flask_restful import Resource, reqparse  # type: ignore
from libs import helper
from libs.helper import uuid_value
from libs.login import login_required
from models.model import App, AppMode, EndUser
from services.app_generate_service import AppGenerateService
from werkzeug.exceptions import InternalServerError, NotFound


class CompletionApi(Resource):
    @validate_user_token_and_extract_info
    def post(self, app_model: App, end_user: EndUser):
        """Generate completion response.
        ---
        tags:
          - service/completion
        summary: Generate completion
        description: Generate a completion response for the provided inputs
        security:
          - ApiKeyAuth: []
        parameters:
          - name: body
            in: body
            required: true
            schema:
              type: object
              required:
                - inputs
              properties:
                inputs:
                  type: object
                  description: Input variables for the completion
                query:
                  type: string
                  description: User query text
                files:
                  type: array
                  description: List of files to process
                response_mode:
                  type: string
                  enum: [blocking, streaming]
                  description: Response delivery mode
                retriever_from:
                  type: string
                  default: dev
                  description: Source of the retriever
        responses:
          200:
            description: Completion generated successfully
          400:
            description: Invalid request
          401:
            description: Invalid or missing token
          404:
            description: App unavailable or conversation not found
        """
        if app_model.mode != "completion":
            raise AppUnavailableError()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, location="json")
        parser.add_argument("query", type=str, location="json", default="")
        parser.add_argument("files", type=list, required=False, location="json")
        parser.add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json")
        parser.add_argument("retriever_from", type=str, required=False, default="dev", location="json")

        args = parser.parse_args()

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


class CompletionStopApi(Resource):
    @validate_user_token_and_extract_info
    def post(self, app_model: App, end_user: EndUser, task_id):
        """Stop a running completion task.
        ---
        tags:
          - service/completion
        summary: Stop completion task
        description: Stop a running completion generation task
        security:
          - ApiKeyAuth: []
        parameters:
          - name: task_id
            in: path
            required: true
            type: string
            description: ID of the task to stop
        responses:
          200:
            description: Task stopped successfully
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: success
          401:
            description: Invalid or missing token
          404:
            description: App unavailable
        """
        if app_model.mode != "completion":
            raise AppUnavailableError()

        AppQueueManager.set_stop_flag(task_id, InvokeFrom.SERVICE_API, end_user.id)

        return {"result": "success"}, 200


class ChatApi(Resource):
    @validate_user_token_and_extract_info
    def post(self, app_model: App, end_user: EndUser):
        """Generate chat response.
        ---
        tags:
          - service/chat
        summary: Generate chat response
        description: Generate a chat response for the provided inputs and query
        security:
          - ApiKeyAuth: []
        parameters:
          - name: body
            in: body
            required: true
            schema:
              type: object
              required:
                - inputs
                - query
              properties:
                inputs:
                  type: object
                  description: Input variables for the chat
                query:
                  type: string
                  description: User query text
                files:
                  type: array
                  description: List of files to process
                response_mode:
                  type: string
                  enum: [blocking, streaming]
                  description: Response delivery mode
                conversation_id:
                  type: string
                  format: uuid
                  description: ID of an existing conversation to continue
                retriever_from:
                  type: string
                  default: dev
                  description: Source of the retriever
                auto_generate_name:
                  type: boolean
                  default: true
                  description: Whether to automatically generate a name for the conversation
        responses:
          200:
            description: Chat response generated successfully
          400:
            description: Invalid request
          401:
            description: Invalid or missing token
          404:
            description: App unavailable or conversation not found
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, location="json")
        parser.add_argument("query", type=str, required=True, location="json")
        parser.add_argument("files", type=list, required=False, location="json")
        parser.add_argument("response_mode", type=str, choices=["blocking", "streaming"], location="json")
        parser.add_argument("conversation_id", type=uuid_value, location="json")
        parser.add_argument("retriever_from", type=str, required=False, default="dev", location="json")
        parser.add_argument("auto_generate_name", type=bool, required=False, default=True, location="json")

        args = parser.parse_args()

        streaming = args["response_mode"] == "streaming"

        try:
            response = AppGenerateService.generate(
                app_model=app_model, user=end_user, args=args, invoke_from=InvokeFrom.SERVICE_API, streaming=streaming
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


class ChatStopApi(Resource):
    @validate_user_token_and_extract_info
    def post(self, app_model: App, end_user: EndUser, task_id):
        """Stop a running chat task.
        ---
        tags:
          - service/chat
        summary: Stop chat task
        description: Stop a running chat generation task
        security:
          - ApiKeyAuth: []
        parameters:
          - name: task_id
            in: path
            required: true
            type: string
            description: ID of the task to stop
        responses:
          200:
            description: Task stopped successfully
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: success
          401:
            description: Invalid or missing token
          404:
            description: App unavailable or not a chat app
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        AppQueueManager.set_stop_flag(task_id, InvokeFrom.SERVICE_API, end_user.id)

        return {"result": "success"}, 200


api.add_resource(CompletionApi, "/completion-messages")
api.add_resource(CompletionStopApi, "/completion-messages/<string:task_id>/stop")
api.add_resource(ChatApi, "/chat-messages")
api.add_resource(ChatStopApi, "/chat-messages/<string:task_id>/stop")
