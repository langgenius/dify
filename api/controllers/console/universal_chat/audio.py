# -*- coding:utf-8 -*-
import logging

from flask import request
from werkzeug.exceptions import InternalServerError

import services
from controllers.console import api
from controllers.console.app.error import AppUnavailableError, ProviderNotInitializeError, \
    ProviderQuotaExceededError, ProviderModelCurrentlyNotSupportError, CompletionRequestError, \
    NoAudioUploadedError, AudioTooLargeError, \
    UnsupportedAudioTypeError, ProviderNotSupportSpeechToTextError
from controllers.console.universal_chat.wraps import UniversalChatResource
from core.llm.error import LLMBadRequestError, LLMAPIUnavailableError, LLMAuthorizationError, LLMAPIConnectionError, \
    LLMRateLimitError, ProviderTokenNotInitError, QuotaExceededError, ModelCurrentlyNotSupportError
from services.audio_service import AudioService, MODEL_FUNASR, MODEL_WHISPER
from services.errors.audio import NoAudioUploadedServiceError, AudioTooLargeServiceError, \
    UnsupportedAudioTypeServiceError, ProviderNotSupportSpeechToTextServiceError
from models.model import AppModelConfig
import logging
logger = logging.getLogger(__name__)


class UniversalChatAudioApi(UniversalChatResource):
    def post(self, universal_app):
        app_model = universal_app
        app_model_config: AppModelConfig = app_model.app_model_config

        if not app_model_config.speech_to_text_dict['enabled']:
            raise AppUnavailableError()
        logger.debug("="*50)
        file = request.files['file']

        try:
            if not app_model_config.speech_to_text_dict['model']: #  use whisper-1 as default
                asr_model = MODEL_WHISPER
            else:
                asr_model = app_model_config.speech_to_text_dict['model']
                if asr_model not in [MODEL_FUNASR, MODEL_WHISPER]:
                    raise ModelCurrentlyNotSupportError(f"asr model:{asr_model} not support")

            logger.debug(f"speech to text use model:{asr_model}")
            audio_service = AudioService.from_model(tenant_id=app_model.tenant_id, model=asr_model)
            response = audio_service(file=file)

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
        

api.add_resource(UniversalChatAudioApi, '/universal-chat/audio-to-text')