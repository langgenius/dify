# -*- coding:utf-8 -*-
import logging

from flask import request
from flask_login import login_required
from werkzeug.exceptions import InternalServerError, NotFound

import services
from controllers.console import api
from controllers.console.app import _get_app
from controllers.console.app.error import AppUnavailableError, \
    ProviderNotInitializeError, CompletionRequestError, ProviderQuotaExceededError, \
    ProviderModelCurrentlyNotSupportError, NoAudioUploadedError, AudioTooLargeError, \
    UnsupportedAudioTypeError, ProviderNotSupportSpeechToTextError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.llm.error import LLMBadRequestError, LLMAPIUnavailableError, LLMAuthorizationError, LLMAPIConnectionError, \
    LLMRateLimitError, ProviderTokenNotInitError, QuotaExceededError, ModelCurrentlyNotSupportError
from flask_restful import Resource
from services.audio_service import AudioService
from services.errors.audio import NoAudioUploadedServiceError, AudioTooLargeServiceError, \
    UnsupportedAudioTypeServiceError, ProviderNotSupportSpeechToTextServiceError


class ChatMessageAudioApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id):
        app_id = str(app_id)
        app_model = _get_app(app_id, 'chat')

        file = request.files['file']

        try:
            response = AudioService.transcript(
                tenant_id=app_model.tenant_id,
                file=file,
            )

            return response
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logging.exception("App model config broken.")
            raise AppUnavailableError()
        except NoAudioUploadedServiceError:
            raise NoAudioUploadedError()
        except AudioTooLargeServiceError as e:
            raise AudioTooLargeError(str(e))
        except UnsupportedAudioTypeServiceError:
            raise UnsupportedAudioTypeError()
        except ProviderNotSupportSpeechToTextServiceError:
            raise ProviderNotSupportSpeechToTextError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
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
        

api.add_resource(ChatMessageAudioApi, '/apps/<uuid:app_id>/audio-to-text')