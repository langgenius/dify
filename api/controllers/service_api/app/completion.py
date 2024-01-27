import json
import logging
from typing import Generator, Union

import services
from controllers.service_api import api
from controllers.service_api.app import create_or_update_end_user_for_user_id
from controllers.service_api.app.error import (AppUnavailableError, CompletionRequestError, ConversationCompletedError,
                                               NotChatAppError, ProviderModelCurrentlyNotSupportError,
                                               ProviderNotInitializeError, ProviderQuotaExceededError)
from controllers.service_api.wraps import AppApiResource
from core.application_queue_manager import ApplicationQueueManager
from core.entities.application_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from flask import Response, stream_with_context
from flask_restful import reqparse
from libs.helper import uuid_value
from services.completion_service import CompletionService
from werkzeug.exceptions import InternalServerError, NotFound


class CompletionApi(AppApiResource):
    def post(self, app_model, end_user):
        if app_model.mode != 'completion':
            raise AppUnavailableError()

        parser = reqparse.RequestParser()
        parser.add_argument('inputs', type=dict, required=True, location='json')
        parser.add_argument('query', type=str, location='json', default='')
        parser.add_argument('files', type=list, required=False, location='json')
        parser.add_argument('response_mode', type=str, choices=['blocking', 'streaming'], location='json')
        parser.add_argument('user', required=True, nullable=False, type=str, location='json')
        parser.add_argument('retriever_from', type=str, required=False, default='dev', location='json')

        args = parser.parse_args()

        streaming = args['response_mode'] == 'streaming'

        if end_user is None and args['user'] is not None:
            end_user = create_or_update_end_user_for_user_id(app_model, args['user'])

        args['auto_generate_name'] = False

        try:
            response = CompletionService.completion(
                app_model=app_model,
                user=end_user,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=streaming,
            )

            return compact_response(response)
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


class CompletionStopApi(AppApiResource):
    def post(self, app_model, end_user, task_id):
        if app_model.mode != 'completion':
            raise AppUnavailableError()

        if end_user is None:
            parser = reqparse.RequestParser()
            parser.add_argument('user', required=True, nullable=False, type=str, location='json')
            args = parser.parse_args()

            user = args.get('user')
            if user is not None:
                end_user = create_or_update_end_user_for_user_id(app_model, user)
            else:
                raise ValueError("arg user muse be input.")

        ApplicationQueueManager.set_stop_flag(task_id, InvokeFrom.SERVICE_API, end_user.id)

        return {'result': 'success'}, 200


class ChatApi(AppApiResource):
    def post(self, app_model, end_user):
        if app_model.mode != 'chat':
            raise NotChatAppError()

        parser = reqparse.RequestParser()
        parser.add_argument('inputs', type=dict, required=True, location='json')
        parser.add_argument('query', type=str, required=True, location='json')
        parser.add_argument('files', type=list, required=False, location='json')
        parser.add_argument('response_mode', type=str, choices=['blocking', 'streaming'], location='json')
        parser.add_argument('conversation_id', type=uuid_value, location='json')
        parser.add_argument('user', type=str, required=True, nullable=False, location='json')
        parser.add_argument('retriever_from', type=str, required=False, default='dev', location='json')
        parser.add_argument('auto_generate_name', type=bool, required=False, default=True, location='json')

        args = parser.parse_args()

        streaming = args['response_mode'] == 'streaming'

        if end_user is None and args['user'] is not None:
            end_user = create_or_update_end_user_for_user_id(app_model, args['user'])

        try:
            response = CompletionService.completion(
                app_model=app_model,
                user=end_user,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=streaming
            )

            return compact_response(response)
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


class ChatStopApi(AppApiResource):
    def post(self, app_model, end_user, task_id):
        if app_model.mode != 'chat':
            raise NotChatAppError()

        if end_user is None:
            parser = reqparse.RequestParser()
            parser.add_argument('user', required=True, nullable=False, type=str, location='json')
            args = parser.parse_args()

            user = args.get('user')
            if user is not None:
                end_user = create_or_update_end_user_for_user_id(app_model, user)
            else:
                raise ValueError("arg user muse be input.")

        ApplicationQueueManager.set_stop_flag(task_id, InvokeFrom.SERVICE_API, end_user.id)

        return {'result': 'success'}, 200


def compact_response(response: Union[dict, Generator]) -> Response:
    if isinstance(response, dict):
        return Response(response=json.dumps(response), status=200, mimetype='application/json')
    else:
        def generate() -> Generator:
            for chunk in response:
                yield chunk

        return Response(stream_with_context(generate()), status=200,
                        mimetype='text/event-stream')


api.add_resource(CompletionApi, '/completion-messages')
api.add_resource(CompletionStopApi, '/completion-messages/<string:task_id>/stop')
api.add_resource(ChatApi, '/chat-messages')
api.add_resource(ChatStopApi, '/chat-messages/<string:task_id>/stop')
