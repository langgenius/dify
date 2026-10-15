import logging
from http import HTTPStatus

from flask import Response, request
from pydantic import field_validator

from controllers.common.audio_response import audio_binary_response
from controllers.common.controller_schemas import TextToAudioPayload as TextToAudioPayloadBase
from controllers.common.errors import InternalServerError
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
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
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from graphon.model_runtime.errors.invoke import InvokeError
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response, uuid_value
from models.model import App, EndUser
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.audio_types import AudioAppRef, AudioUpload
from services.entities.message_entities import MessageEndUser
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)


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
    @error_responses(
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
    @web_ns.doc("Audio to Text")
    @web_ns.doc(description="Convert audio file to text using speech-to-text service.")
    @web_ns.doc(
        responses={
            HTTPStatus.OK: "Success",
            HTTPStatus.BAD_REQUEST: "Bad Request",
            HTTPStatus.UNAUTHORIZED: "Unauthorized",
            HTTPStatus.NOT_FOUND: "App or end user not found",
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE: "Audio file too large",
            HTTPStatus.UNSUPPORTED_MEDIA_TYPE: "Unsupported audio type",
            HTTPStatus.INTERNAL_SERVER_ERROR: "Internal Server Error",
        }
    )
    @web_ns.response(HTTPStatus.OK, "Success", web_ns.models[AudioToTextResponse.__name__])
    def post(self, app_model: App, end_user: EndUser) -> dict[str, object]:
        """Convert audio to text"""
        file = request.files.get("file")

        try:
            response = application_services().app_audio.transcript_asr(
                app=AudioAppRef(app_id=app_model.id, tenant_id=app_model.tenant_id, app_mode=app_model.mode),
                audio=AudioUpload(stream=file.stream, mime_type=file.mimetype) if file is not None else None,
                end_user=end_user.external_user_id,
            )

            return dump_response(AudioToTextResponse, response)
        except AppDefinitionUnavailableError as e:
            raise AppUnavailableError() from e
        except AppModelConfigBrokenError:
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
        except (BaseHTTPException, ValueError):
            raise
        except Exception as e:
            logger.exception("Failed to handle post request to AudioApi")
            raise InternalServerError() from e


@web_ns.route("/text-to-audio")
class TextApi(WebApiResource):
    @error_responses(
        AppUnavailableError,
        CompletionRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @web_ns.expect(web_ns.models[TextToAudioPayload.__name__])
    @web_ns.doc("Text to Audio")
    @web_ns.doc(description="Convert text to audio using text-to-speech service.")
    @web_ns.doc(
        responses={
            HTTPStatus.OK: "Success; null when no message audio is available",
            HTTPStatus.BAD_REQUEST: "Bad Request",
            HTTPStatus.UNAUTHORIZED: "Unauthorized",
            HTTPStatus.NOT_FOUND: "App or end user not found",
            HTTPStatus.UNPROCESSABLE_ENTITY: "Invalid request payload",
            HTTPStatus.INTERNAL_SERVER_ERROR: "Internal Server Error",
        }
    )
    @web_ns.response(HTTPStatus.OK, "Success; null when no message audio is available")
    @model_validate(TextToAudioPayload)
    def post(self, payload: TextToAudioPayload, app_model: App, end_user: EndUser) -> Response | None:
        """Convert text to audio"""
        try:
            output = application_services().app_audio.transcript_tts(
                app=AudioAppRef(app_id=app_model.id, tenant_id=app_model.tenant_id, app_mode=app_model.mode),
                actor=MessageEndUser(end_user_id=end_user.id),
                text=payload.text,
                voice=payload.voice,
                end_user=end_user.external_user_id,
                message_id=payload.message_id,
            )
            # response-contract:ignore audio_binary_response
            return audio_binary_response(output)
        except AppDefinitionUnavailableError as e:
            raise AppUnavailableError() from e
        except AppModelConfigBrokenError:
            logger.exception("App model config broken.")
            raise AppUnavailableError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except (BaseHTTPException, ValueError):
            raise
        except Exception as e:
            logger.exception("Failed to handle post request to TextApi")
            raise InternalServerError() from e
