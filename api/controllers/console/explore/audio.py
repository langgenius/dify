import logging

from flask import request
from werkzeug.exceptions import InternalServerError

import services
from controllers.common.controller_schemas import TextToAudioPayload
from controllers.common.fields import AudioBinaryResponse, AudioTranscriptResponse
from controllers.common.schema import register_response_schema_models, register_schema_model
from controllers.console.app.error import (
    AppUnavailableError,
    AudioTooLargeError,
    CompletionRequestError,
    NoAudioUploadedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderNotSupportSpeechToTextError,
    ProviderQuotaExceededError,
    UnsupportedAudioTypeError,
)
from controllers.console.explore.wraps import InstalledAppResource
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from extensions.ext_database import db
from graphon.model_runtime.errors.invoke import InvokeError
from libs.login import current_account_with_tenant
from models.model import InstalledApp
from services.app_ref_service import AppRefService
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    UnsupportedAudioTypeServiceError,
)

from .. import console_ns

logger = logging.getLogger(__name__)

register_schema_model(console_ns, TextToAudioPayload)
register_response_schema_models(console_ns, AudioBinaryResponse, AudioTranscriptResponse)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/audio-to-text",
    endpoint="installed_app_audio",
)
class ChatAudioApi(InstalledAppResource):
    @console_ns.response(200, "Success", console_ns.models[AudioTranscriptResponse.__name__])
    def post(self, installed_app: InstalledApp):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()

        file = request.files["file"]

        try:
            response = AudioService.transcript_asr(app_model=app_model, file=file, end_user=None)

            return response
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logger.exception("App model config broken.")
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
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception as e:
            logger.exception("internal server error.")
            raise InternalServerError()


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/text-to-audio",
    endpoint="installed_app_text",
)
class ChatTextApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[TextToAudioPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[AudioBinaryResponse.__name__])
    def post(self, installed_app: InstalledApp):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()
        try:
            payload = TextToAudioPayload.model_validate(console_ns.payload or {})

            message_id = payload.message_id
            text = payload.text
            voice = payload.voice
            message_ref = None
            if message_id:
                current_user, _ = current_account_with_tenant()
                app_ref = AppRefService.create_app_ref(app_model)
                message_ref = AppRefService.create_message_ref(
                    app_ref,
                    message_id,
                    account_id=current_user.id,
                )

            response = AudioService.transcript_tts(
                app_model=app_model,
                session=db.session(),
                text=text,
                voice=voice,
                message_ref=message_ref,
            )
            return response
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logger.exception("App model config broken.")
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
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception as e:
            logger.exception("internal server error.")
            raise InternalServerError()
