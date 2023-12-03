import json
import logging
from typing import Generator, Union

from flask import Response, stream_with_context
from flask_login import current_user
from flask_restful import reqparse
from werkzeug.exceptions import InternalServerError, NotFound

import services
from controllers.console import api
from controllers.console.app.error import ConversationCompletedError, AppUnavailableError, ProviderNotInitializeError, \
    ProviderQuotaExceededError, ProviderModelCurrentlyNotSupportError, CompletionRequestError
from controllers.console.universal_chat.wraps import UniversalChatResource
from core.conversation_message_task import PubHandler
from core.model_providers.error import ProviderTokenNotInitError, QuotaExceededError, ModelCurrentlyNotSupportError, \
    LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError, LLMRateLimitError, LLMAuthorizationError
from libs.helper import uuid_value
from services.completion_service import CompletionService


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
                from_source='console',
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
        except (LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError,
                LLMRateLimitError, LLMAuthorizationError) as e:
            raise CompletionRequestError(str(e))
        except ValueError as e:
            raise e
        except Exception as e:
            logging.exception("internal server error.")
            raise InternalServerError()


class UniversalChatStopApi(UniversalChatResource):
    def post(self, universal_app, task_id):
        PubHandler.stop(current_user, task_id)

        return {'result': 'success'}, 200


def compact_response(response: Union[dict, Generator]) -> Response:
    if isinstance(response, dict):
        return Response(response=json.dumps(response), status=200, mimetype='application/json')
    else:
        def generate() -> Generator:
            try:
                for chunk in response:
                    yield chunk
            except services.errors.conversation.ConversationNotExistsError:
                yield "data: " + json.dumps(api.handle_error(NotFound("Conversation Not Exists.")).get_json()) + "\n\n"
            except services.errors.conversation.ConversationCompletedError:
                yield "data: " + json.dumps(api.handle_error(ConversationCompletedError()).get_json()) + "\n\n"
            except services.errors.app_model_config.AppModelConfigBrokenError:
                logging.exception("App model config broken.")
                yield "data: " + json.dumps(api.handle_error(AppUnavailableError()).get_json()) + "\n\n"
            except ProviderTokenNotInitError:
                yield "data: " + json.dumps(api.handle_error(ProviderNotInitializeError()).get_json()) + "\n\n"
            except QuotaExceededError:
                yield "data: " + json.dumps(api.handle_error(ProviderQuotaExceededError()).get_json()) + "\n\n"
            except ModelCurrentlyNotSupportError:
                yield "data: " + json.dumps(api.handle_error(ProviderModelCurrentlyNotSupportError()).get_json()) + "\n\n"
            except (LLMBadRequestError, LLMAPIConnectionError, LLMAPIUnavailableError,
                    LLMRateLimitError, LLMAuthorizationError) as e:
                yield "data: " + json.dumps(api.handle_error(CompletionRequestError(str(e))).get_json()) + "\n\n"
            except ValueError as e:
                yield "data: " + json.dumps(api.handle_error(e).get_json()) + "\n\n"
            except Exception:
                logging.exception("internal server error.")
                yield "data: " + json.dumps(api.handle_error(InternalServerError()).get_json()) + "\n\n"

        return Response(stream_with_context(generate()), status=200,
                        mimetype='text/event-stream')


api.add_resource(UniversalChatApi, '/universal-chat/messages')
api.add_resource(UniversalChatStopApi, '/universal-chat/messages/<string:task_id>/stop')
