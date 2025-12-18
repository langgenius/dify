import logging

from flask import request
from flask_restx import fields, marshal_with
from pydantic import BaseModel, field_validator
from werkzeug.exceptions import InternalServerError

import services
from controllers.web import web_ns
from controllers.web.error import (
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
from controllers.web.wraps import WebApiResource
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from libs.helper import uuid_value
from models.model import App
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    UnsupportedAudioTypeServiceError,
)

from ..common.schema import register_schema_models


class TextToAudioPayload(BaseModel):
    message_id: str | None = None
    voice: str | None = None
    text: str | None = None
    streaming: bool | None = None

    @field_validator("message_id")
    @classmethod
    def validate_message_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


register_schema_models(web_ns, TextToAudioPayload)

logger = logging.getLogger(__name__)


@web_ns.route("/audio-to-text")
class AudioApi(WebApiResource):
    audio_to_text_response_fields = {
        "text": fields.String,
    }

    @marshal_with(audio_to_text_response_fields)
    @web_ns.doc("Audio to Text")
    @web_ns.doc(description="Convert audio file to text using speech-to-text service.")
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            413: "Audio file too large",
            415: "Unsupported audio type",
            500: "Internal Server Error",
        }
    )
    def post(self, app_model: App, end_user):
        """Convert audio to text"""
        file = request.files["file"]

        try:
            response = AudioService.transcript_asr(app_model=app_model, file=file, end_user=end_user)

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
            logger.exception("Failed to handle post request to AudioApi")
            raise InternalServerError()


@web_ns.route("/text-to-audio")
class TextApi(WebApiResource):
    @web_ns.expect(web_ns.models[TextToAudioPayload.__name__])
    @web_ns.doc("Text to Audio")
    @web_ns.doc(description="Convert text to audio using text-to-speech service.")
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            500: "Internal Server Error",
        }
    )
    def post(self, app_model: App, end_user):
        """Convert text to audio"""
        try:
            payload = TextToAudioPayload.model_validate(web_ns.payload or {})

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
            logger.exception("Failed to handle post request to TextApi")
            raise InternalServerError()
