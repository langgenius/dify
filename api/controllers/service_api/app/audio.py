import logging

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import InternalServerError

import services
from controllers.common.schema import register_schema_model
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import (
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
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from models.model import App, EndUser
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    UnsupportedAudioTypeServiceError,
)

logger = logging.getLogger(__name__)


@service_api_ns.route("/audio-to-text")
class AudioApi(Resource):
    @service_api_ns.doc("audio_to_text")
    @service_api_ns.doc(description="Convert audio to text using speech-to-text")
    @service_api_ns.doc(
        responses={
            200: "Audio successfully transcribed",
            400: "Bad request - no audio or invalid audio",
            401: "Unauthorized - invalid API token",
            413: "Audio file too large",
            415: "Unsupported audio type",
            500: "Internal server error",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.FORM))
    def post(self, app_model: App, end_user: EndUser):
        """Convert audio to text using speech-to-text.

        Accepts an audio file upload and returns the transcribed text.
        """
        file = request.files["file"]

        try:
            response = AudioService.transcript_asr(app_model=app_model, file=file, end_user=end_user.id)

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


class TextToAudioPayload(BaseModel):
    message_id: str | None = Field(default=None, description="Message ID")
    voice: str | None = Field(default=None, description="Voice to use for TTS")
    text: str | None = Field(default=None, description="Text to convert to audio")
    streaming: bool | None = Field(default=None, description="Enable streaming response")


register_schema_model(service_api_ns, TextToAudioPayload)


@service_api_ns.route("/text-to-audio")
class TextApi(Resource):
    @service_api_ns.expect(service_api_ns.models[TextToAudioPayload.__name__])
    @service_api_ns.doc("text_to_audio")
    @service_api_ns.doc(description="Convert text to audio using text-to-speech")
    @service_api_ns.doc(
        responses={
            200: "Text successfully converted to audio",
            400: "Bad request - invalid parameters",
            401: "Unauthorized - invalid API token",
            500: "Internal server error",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    def post(self, app_model: App, end_user: EndUser):
        """Convert text to audio using text-to-speech.

        Converts the provided text to audio using the specified voice.
        """
        try:
            payload = TextToAudioPayload.model_validate(service_api_ns.payload or {})

            message_id = payload.message_id
            text = payload.text
            voice = payload.voice
            response = AudioService.transcript_tts(
                app_model=app_model, text=text, voice=voice, end_user=end_user.external_user_id, message_id=message_id
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
