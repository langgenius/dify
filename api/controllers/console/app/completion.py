import json
import logging
from collections.abc import Generator
from typing import Union

import flask_login
from flask import Response, stream_with_context
from flask_restful import Resource, reqparse
from werkzeug.exceptions import InternalServerError, NotFound

import services
from controllers.console import api
from controllers.console.app import _get_app
from controllers.console.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.application_queue_manager import ApplicationQueueManager
from core.entities.application_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from libs.helper import uuid_value
from libs.login import login_required
from services.completion_service import CompletionService


# define completion message api for user
class CompletionMessageApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id):
        app_id = str(app_id)

        # get app info
        app_model = _get_app(app_id, 'completion')

        parser = reqparse.RequestParser()
        parser.add_argument('inputs', type=dict, required=True, location='json')
        parser.add_argument('query', type=str, location='json', default='')
        parser.add_argument('files', type=list, required=False, location='json')
        parser.add_argument('model_config', type=dict, required=True, location='json')
        parser.add_argument('response_mode', type=str, choices=['blocking', 'streaming'], location='json')
        parser.add_argument('retriever_from', type=str, required=False, default='dev', location='json')
        args = parser.parse_args()

        streaming = args['response_mode'] != 'blocking'
        args['auto_generate_name'] = False

        account = flask_login.current_user

        try:
            response = CompletionService.completion(
                app_model=app_model,
                user=account,
                args=args,
                invoke_from=InvokeFrom.DEBUGGER,
                streaming=streaming,
                is_model_config_override=True
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


class CompletionMessageStopApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id, task_id):
        app_id = str(app_id)

        # get app info
        _get_app(app_id, 'completion')

        account = flask_login.current_user

        ApplicationQueueManager.set_stop_flag(task_id, InvokeFrom.DEBUGGER, account.id)

        return {'result': 'success'}, 200


class ChatMessageApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id):
        app_id = str(app_id)

        # get app info
        app_model = _get_app(app_id, 'chat')

        parser = reqparse.RequestParser()
        parser.add_argument('inputs', type=dict, required=True, location='json')
        parser.add_argument('query', type=str, required=True, location='json')
        parser.add_argument('files', type=list, required=False, location='json')
        parser.add_argument('model_config', type=dict, required=True, location='json')
        parser.add_argument('conversation_id', type=uuid_value, location='json')
        parser.add_argument('response_mode', type=str, choices=['blocking', 'streaming'], location='json')
        parser.add_argument('retriever_from', type=str, required=False, default='dev', location='json')
        args = parser.parse_args()

        streaming = args['response_mode'] != 'blocking'
        args['auto_generate_name'] = False

        account = flask_login.current_user

        try:
            response = CompletionService.completion(
                app_model=app_model,
                user=account,
                args=args,
                invoke_from=InvokeFrom.DEBUGGER,
                streaming=streaming,
                is_model_config_override=True
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


def compact_response(response: Union[dict, Generator]) -> Response:
    if isinstance(response, dict):
        return Response(response=json.dumps(response), status=200, mimetype='application/json')
    else:
        def generate() -> Generator:
            yield from response

        return Response(stream_with_context(generate()), status=200,
                        mimetype='text/event-stream')


class ChatMessageStopApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id, task_id):
        app_id = str(app_id)

        # get app info
        _get_app(app_id, 'chat')

        account = flask_login.current_user

        ApplicationQueueManager.set_stop_flag(task_id, InvokeFrom.DEBUGGER, account.id)

        return {'result': 'success'}, 200


api.add_resource(CompletionMessageApi, '/apps/<uuid:app_id>/completion-messages')
api.add_resource(CompletionMessageStopApi, '/apps/<uuid:app_id>/completion-messages/<string:task_id>/stop')
api.add_resource(ChatMessageApi, '/apps/<uuid:app_id>/chat-messages')
api.add_resource(ChatMessageStopApi, '/apps/<uuid:app_id>/chat-messages/<string:task_id>/stop')
