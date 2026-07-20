import logging

from flask import request
from pydantic import field_validator
from werkzeug.exceptions import InternalServerError

import services
from controllers.common.controller_schemas import TextToAudioPayload as TextToAudioPayloadBase
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
    SpeechToTextDisabledError,
    UnsupportedAudioTypeError,
)
from controllers.web.wraps import WebApiResource
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from extensions.ext_database import db
from fields.base import ResponseModel
from graphon.model_runtime.errors.invoke import InvokeError
from libs.helper import dump_response, uuid_value
from models.model import App, EndUser
from services.app_ref_service import AppRefService
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)

from ..common.schema import register_response_schema_models, register_schema_models


class AudioToTextResponse(ResponseModel):
    text: str


class TextToAudioPayload(TextToAudioPayloadBase):
    @field_validator("message_id")
    @classmethod
    def validate_message_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


register_schema_models(web_ns, TextToAudioPayload)
register_response_schema_models(web_ns, AudioToTextResponse)

logger = logging.getLogger(__name__)


@web_ns.route("/audio-to-text")
class AudioApi(WebApiResource):
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
    @web_ns.response(200, "Success", web_ns.models[AudioToTextResponse.__name__])
    def post(self, app_model: App, end_user: EndUser):
        """Convert audio to text"""
        file = request.files["file"]

        try:
            response = AudioService.transcript_asr(
                app_model=app_model,
                file=file,
                session=db.session(),
                end_user=end_user.external_user_id,
            )

            return dump_response(AudioToTextResponse, response)
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
        except SpeechToTextDisabledServiceError:
            raise SpeechToTextDisabledError()
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
    # response-contract:ignore provider audio bytes; TODO: model binary audio response if shape is standardized.
    @web_ns.response(200, "Success")
    def post(self, app_model: App, end_user: EndUser):
        """Convert text to audio"""
        try:
            payload = TextToAudioPayload.model_validate(web_ns.payload or {})

            message_id = payload.message_id
            text = payload.text
            voice = payload.voice
            message_ref = None
            if message_id:
                app_ref = AppRefService.create_app_ref(app_model)
                message_ref = AppRefService.create_message_ref(
                    app_ref,
                    message_id,
                    end_user_id=end_user.id,
                )
            return AudioService.transcript_tts(
                app_model=app_model,
                session=db.session(),
                text=text,
                voice=voice,
                end_user=end_user.external_user_id,
                message_ref=message_ref,
            )
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
