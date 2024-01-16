import json
import logging
from typing import Generator, Union

import services
from controllers.console import api
from controllers.console.app.error import (AppUnavailableError, CompletionRequestError, ConversationCompletedError,
                                           ProviderModelCurrentlyNotSupportError, ProviderNotInitializeError,
                                           ProviderQuotaExceededError)
from controllers.console.universal_chat.wraps import UniversalChatResource
from core.application_queue_manager import ApplicationQueueManager
from core.entities.application_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from flask import Response, stream_with_context
from flask_login import current_user
from flask_restful import reqparse
from libs.helper import uuid_value
from services.completion_service import CompletionService
from werkzeug.exceptions import InternalServerError, NotFound


class UniversalChatApi(UniversalChatResource):
    def post(self, universal_app):
        app_model = universal_app

        parser = reqparse.RequestParser()
        parser.add_argument('query', type=str, required=True, location='json')
        parser.add_argument('files', type=list, required=False, location='json')
        parser.add_argument('conversation_id', type=uuid_value, location='json')
        parser.add_argument('provider', type=str, required=True, location='json')
        parser.add_argument('model', type=str, required=True, location='json')
        parser.add_argument('tools', type=list, required=True, location='json')
        parser.add_argument('retriever_from', type=str, required=False, default='universal_app', location='json')
        args = parser.parse_args()

        app_model_config = app_model.app_model_config

        # update app model config
        args['model_config'] = app_model_config.to_dict()
        args['model_config']['model']['name'] = args['model']
        args['model_config']['model']['provider'] = args['provider']
        args['model_config']['agent_mode']['tools'] = args['tools']

        if not args['model_config']['agent_mode']['tools']:
            args['model_config']['agent_mode']['tools'] = [
                {
                    "current_datetime": {
                        "enabled": True
                    }
                }
            ]
        else:
            args['model_config']['agent_mode']['tools'].append({
                    "current_datetime": {
                        "enabled": True
                    }
                })

        args['inputs'] = {}

        del args['model']
        del args['tools']

        args['auto_generate_name'] = False

        try:
            response = CompletionService.completion(
                app_model=app_model,
                user=current_user,
                args=args,
                invoke_from=InvokeFrom.EXPLORE,
                streaming=True,
                is_model_config_override=True,
            )

            return compact_response(response)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationCompletedError:
            raise ConversationCompletedError()
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logging.exception("App model config broken.")
            raise AppUnavailableError()
        except ProviderTokenNotInitError:
            raise ProviderNotInitializeError()
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


class UniversalChatStopApi(UniversalChatResource):
    def post(self, universal_app, task_id):
        ApplicationQueueManager.set_stop_flag(task_id, InvokeFrom.EXPLORE, current_user.id)

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


api.add_resource(UniversalChatApi, '/universal-chat/messages')
api.add_resource(UniversalChatStopApi, '/universal-chat/messages/<string:task_id>/stop')
