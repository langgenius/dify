# -*- coding:utf-8 -*-
import logging

from flask import request
from werkzeug.exceptions import InternalServerError

import services
from controllers.web import api
from controllers.web.error import AppUnavailableError, ProviderNotInitializeError, CompletionRequestError, \
    ProviderQuotaExceededError, ProviderModelCurrentlyNotSupportError
from controllers.web.wraps import WebApiResource
from core.llm.error import LLMBadRequestError, LLMAPIUnavailableError, LLMAuthorizationError, LLMAPIConnectionError, \
    LLMRateLimitError, ProviderTokenNotInitError, QuotaExceededError, ModelCurrentlyNotSupportError
from services.audio_service import AudioService
from models.model import App


class AudioApi(WebApiResource):
    def post(self, app_model: App, end_user):
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

api.add_resource(AudioApi, '/audio-to-text')