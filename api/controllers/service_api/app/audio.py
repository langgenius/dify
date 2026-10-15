import logging
from http import HTTPStatus

from flask import Response, request
from flask_restx import Resource

from controllers.common.audio_response import audio_binary_response
from controllers.common.controller_schemas import TextToAudioPayload
from controllers.common.errors import InternalServerError
from controllers.common.fields import AudioBinaryResponse, AudioTranscriptResponse
from controllers.common.schema import register_response_schema_models, register_schema_model
from controllers.console.wraps import model_validate
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
    SpeechToTextDisabledError,
    UnsupportedAudioTypeError,
)
from controllers.service_api.flask_admission import service_api_end_user_admission
from controllers.service_api.schema import binary_response, expect_with_user, multipart_file_params
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg
from core.base.tts.audio_mime import SUPPORTED_TTS_AUDIO_MIME_TYPES
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from extensions.ext_application_services import application_services
from graphon.model_runtime.errors.invoke import InvokeError
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import ServiceApiEndUserContext
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

logger = logging.getLogger(__name__)

register_response_schema_models(service_api_ns, AudioBinaryResponse, AudioTranscriptResponse)


@service_api_ns.route("/audio-to-text")
class AudioApi(Resource):
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
    @service_api_ns.doc(
        summary="Convert Audio to Text",
        description=(
            "Convert audio file to text. Supported MIME types: `audio/mp3`, `audio/mpga`, `audio/m4a`, "
            "`audio/x-m4a`, `audio/wav`, and `audio/amr`. File size limit is `30 MB`."
        ),
        tags=["TTS"],
        responses={
            HTTPStatus.OK: "Successfully converted audio to text.",
            HTTPStatus.BAD_REQUEST: (
                "- `app_unavailable` : App unavailable or misconfigured.\n"
                "- `no_audio_uploaded` : No audio file was uploaded.\n"
                "- `bad_request` : Invalid request or resource-token application selection.\n"
                "- `invalid_param` : Invalid request parameters.\n"
                "- `speech_to_text_disabled` : Speech-to-text is disabled for this app.\n"
                "- `provider_not_support_speech_to_text` : Model provider does not support speech-to-text.\n"
                "- `provider_not_initialize` : No valid model provider credentials found.\n"
                "- `provider_quota_exceeded` : Model provider quota exhausted.\n"
                "- `model_currently_not_support` : Current model does not support this operation.\n"
                "- `completion_request_error` : Speech recognition request failed."
            ),
            HTTPStatus.UNAUTHORIZED: "Unauthorized - invalid API token",
            HTTPStatus.FORBIDDEN: "Application or workspace access denied",
            HTTPStatus.NOT_FOUND: "Resource-token target not found",
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE: "`audio_too_large` : Audio file size exceeded the limit.",
            HTTPStatus.UNSUPPORTED_MEDIA_TYPE: "`unsupported_audio_type` : Audio type is not allowed.",
            HTTPStatus.INTERNAL_SERVER_ERROR: "`internal_server_error` : Internal server error.",
        },
    )
    @service_api_ns.doc("audio_to_text")
    @service_api_ns.doc(description="Convert audio to text using speech-to-text")
    @service_api_ns.doc(
        consumes=["multipart/form-data"],
        params=multipart_file_params(
            include_user=True,
            file_description=(
                "Audio file to transcribe. Supported MIME types: `audio/mp3`, `audio/mpga`, `audio/m4a`, "
                "`audio/x-m4a`, `audio/wav`, and `audio/amr`. File size limit is `30 MB`."
            ),
        ),
    )
    @service_api_ns.response(
        HTTPStatus.OK,
        "Audio successfully transcribed",
        service_api_ns.models[AudioTranscriptResponse.__name__],
    )
    @service_api_end_user_admission(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.FORM))
    def post(self, context: ServiceApiEndUserContext) -> dict[str, object]:
        """Convert audio to text using speech-to-text.

        Accepts an audio file upload and returns the transcribed text.
        """
        file = request.files.get("file")

        try:
            response = application_services().app_audio.transcript_asr(
                app=AudioAppRef(app_id=context.app_id, tenant_id=context.tenant_id, app_mode=context.app_mode),
                audio=AudioUpload(stream=file.stream, mime_type=file.mimetype) if file is not None else None,
                end_user=context.end_user_id,
            )

            return dump_response(AudioTranscriptResponse, response)
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
            logger.exception("internal server error.")
            raise InternalServerError() from e


register_schema_model(service_api_ns, TextToAudioPayload)


@service_api_ns.route("/text-to-audio")
class TextApi(Resource):
    @error_responses(
        AppUnavailableError,
        CompletionRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @service_api_ns.doc(
        summary="Convert Text to Audio",
        description="Convert text to speech.",
        tags=["TTS"],
        responses={
            HTTPStatus.OK: (
                "Returns the generated audio. The `Content-Type` header reflects the provider audio container, "
                "verified from the response bytes when recognizable. The binary response can be AAC, FLAC, MP4, "
                "MP3, Ogg, WAV, or WebM. Returns null when no message audio is available."
            ),
            HTTPStatus.BAD_REQUEST: (
                "- `app_unavailable` : App unavailable or misconfigured.\n"
                "- `bad_request` : Invalid JSON or resource-token application selection.\n"
                "- `invalid_param` : Missing or invalid text or request parameters.\n"
                "- `provider_not_initialize` : No valid model provider credentials found.\n"
                "- `provider_quota_exceeded` : Model provider quota exhausted.\n"
                "- `model_currently_not_support` : Current model does not support this operation.\n"
                "- `completion_request_error` : Text-to-speech request failed."
            ),
            HTTPStatus.UNAUTHORIZED: "Unauthorized - invalid API token",
            HTTPStatus.FORBIDDEN: "Application or workspace access denied",
            HTTPStatus.NOT_FOUND: "Resource-token target not found",
            HTTPStatus.UNSUPPORTED_MEDIA_TYPE: "Request body must use application/json",
            HTTPStatus.UNPROCESSABLE_ENTITY: "Invalid request payload",
            HTTPStatus.INTERNAL_SERVER_ERROR: "`internal_server_error` : Internal server error.",
        },
    )
    @expect_with_user(service_api_ns, TextToAudioPayload)
    @binary_response(service_api_ns, SUPPORTED_TTS_AUDIO_MIME_TYPES)
    @service_api_ns.doc("text_to_audio")
    @service_api_ns.doc(description="Convert text to audio using text-to-speech")
    # TTS returns provider audio bytes, so the success response is intentionally schema-less.
    @service_api_ns.response(
        HTTPStatus.OK, "Text successfully converted to audio; null when no message audio is available"
    )
    @service_api_end_user_admission(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    @model_validate(TextToAudioPayload)
    def post(self, payload: TextToAudioPayload, context: ServiceApiEndUserContext) -> Response | None:
        """Convert text to audio using text-to-speech.

        Converts the provided text to audio using the specified voice.
        """
        try:
            output = application_services().app_audio.transcript_tts(
                app=AudioAppRef(app_id=context.app_id, tenant_id=context.tenant_id, app_mode=context.app_mode),
                actor=MessageEndUser(end_user_id=context.end_user_id),
                text=payload.text,
                voice=payload.voice,
                end_user=context.external_user_id,
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
            logger.exception("internal server error.")
            raise InternalServerError() from e
