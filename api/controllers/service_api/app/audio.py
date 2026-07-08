import logging

from flask import request
from flask_restx import Resource
from werkzeug.exceptions import InternalServerError

import services
from controllers.common.controller_schemas import TextToAudioPayload
from controllers.common.fields import AudioBinaryResponse, AudioTranscriptResponse
from controllers.common.schema import register_response_schema_models, register_schema_model
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
from controllers.service_api.schema import binary_response, expect_with_user, multipart_file_params
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from extensions.ext_database import db
from graphon.model_runtime.errors.invoke import InvokeError
from models.model import App, EndUser
from services.app_ref_service import AppRefService
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    UnsupportedAudioTypeServiceError,
)

logger = logging.getLogger(__name__)

register_response_schema_models(service_api_ns, AudioBinaryResponse, AudioTranscriptResponse)


@service_api_ns.route("/audio-to-text")
class AudioApi(Resource):
    @service_api_ns.doc(
        summary="Convert Audio to Text",
        description=(
            "Convert audio file to text. Supported MIME types: `audio/mp3`, `audio/mpga`, `audio/m4a`, "
            "`audio/wav`, and `audio/amr`. File size limit is `30 MB`."
        ),
        tags=["TTS"],
        responses={
            200: "Successfully converted audio to text.",
            400: (
                "- `app_unavailable` : App unavailable or misconfigured.\n"
                "- `provider_not_support_speech_to_text` : Model provider does not support speech-to-text.\n"
                "- `provider_not_initialize` : No valid model provider credentials found.\n"
                "- `provider_quota_exceeded` : Model provider quota exhausted.\n"
                "- `model_currently_not_support` : Current model does not support this operation.\n"
                "- `completion_request_error` : Speech recognition request failed."
            ),
            413: "`audio_too_large` : Audio file size exceeded the limit.",
            415: "`unsupported_audio_type` : Audio type is not allowed.",
            500: "`internal_server_error` : Internal server error.",
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
                "`audio/wav`, and `audio/amr`. File size limit is `30 MB`."
            ),
        ),
    )
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
    @service_api_ns.response(
        200,
        "Audio successfully transcribed",
        service_api_ns.models[AudioTranscriptResponse.__name__],
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


register_schema_model(service_api_ns, TextToAudioPayload)


@service_api_ns.route("/text-to-audio")
class TextApi(Resource):
    @service_api_ns.doc(
        summary="Convert Text to Audio",
        description="Convert text to speech.",
        tags=["TTS"],
        responses={
            200: (
                "Returns the generated audio. Generator responses are streamed by the service as `audio/mpeg`; "
                "otherwise the provider output is returned directly."
            ),
            400: (
                "- `app_unavailable` : App unavailable or misconfigured.\n"
                "- `provider_not_initialize` : No valid model provider credentials found.\n"
                "- `provider_quota_exceeded` : Model provider quota exhausted.\n"
                "- `model_currently_not_support` : Current model does not support this operation.\n"
                "- `completion_request_error` : Text-to-speech request failed."
            ),
            500: "`internal_server_error` : Internal server error.",
        },
    )
    @expect_with_user(service_api_ns, TextToAudioPayload)
    @binary_response(service_api_ns, "audio/mpeg")
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
    @service_api_ns.response(200, "Text successfully converted to audio")
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
            message_ref = None
            if message_id:
                app_ref = AppRefService.create_app_ref(app_model)
                message_ref = AppRefService.create_message_ref(
                    app_ref,
                    message_id,
                    end_user_id=end_user.id,
                )
            response = AudioService.transcript_tts(
                app_model=app_model,
                session=db.session(),
                text=text,
                voice=voice,
                end_user=end_user.external_user_id,
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
