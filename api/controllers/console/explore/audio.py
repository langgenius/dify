"""Installed-app audio admission, error translation, and response serialization."""

import logging
from collections.abc import Callable
from functools import wraps

from flask import Response, request, stream_with_context
from flask_restx import Resource
from werkzeug.exceptions import HTTPException, InternalServerError

from controllers.common.controller_schemas import TextToAudioPayload
from controllers.common.fields import AudioBinaryResponse, AudioTranscriptResponse
from controllers.common.schema import register_response_schema_models, register_schema_model
from controllers.console import console_ns
from controllers.console.app.error import (
    AppUnavailableError,
    AudioTooLargeError,
    CompletionRequestError,
    NoAudioUploadedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderNotSupportSpeechToTextError,
    ProviderNotSupportTextToSpeechError,
    ProviderQuotaExceededError,
    SpeechToTextDisabledError,
    UnsupportedAudioTypeError,
)
from controllers.console.explore.error import InstalledAppNotFoundHTTPError
from controllers.console.explore.installed_app_admission import get_installed_app
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from core.base.tts.audio_mime import inspect_audio_stream, resolve_audio_mime_type
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from extensions.ext_application_services import application_services
from graphon.model_runtime.errors.invoke import InvokeError
from libs.helper import dump_response
from machinery.context import RequestContext
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_audio_service import AudioUpload

logger = logging.getLogger(__name__)

register_schema_model(console_ns, TextToAudioPayload)
register_response_schema_models(console_ns, AudioBinaryResponse, AudioTranscriptResponse)


def _audio_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except InstalledAppNotFoundError as error:
            raise InstalledAppNotFoundHTTPError() from error
        except AppModelConfigBrokenError as error:
            logger.exception("App model config broken")
            raise AppUnavailableError() from error
        except NoAudioUploadedServiceError as error:
            raise NoAudioUploadedError() from error
        except AudioTooLargeServiceError as error:
            raise AudioTooLargeError(str(error)) from error
        except UnsupportedAudioTypeServiceError as error:
            raise UnsupportedAudioTypeError() from error
        except ProviderNotSupportSpeechToTextServiceError as error:
            raise ProviderNotSupportSpeechToTextError() from error
        except ProviderNotSupportTextToSpeechServiceError as error:
            raise ProviderNotSupportTextToSpeechError() from error
        except SpeechToTextDisabledServiceError as error:
            raise SpeechToTextDisabledError() from error
        except ProviderTokenNotInitError as error:
            raise ProviderNotInitializeError(error.description) from error
        except QuotaExceededError as error:
            raise ProviderQuotaExceededError() from error
        except ModelCurrentlyNotSupportError as error:
            raise ProviderModelCurrentlyNotSupportError() from error
        except InvokeError as error:
            raise CompletionRequestError(error.description) from error
        except (HTTPException, ValueError):
            raise
        except Exception as error:
            logger.exception("Installed-app audio operation failed")
            raise InternalServerError() from error

    return decorated


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/audio-to-text",
    endpoint="installed_app_audio",
)
class ChatAudioApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[AudioTranscriptResponse.__name__])
    @console_account_admission()
    @get_installed_app
    @_audio_errors
    def post(self, request_context: RequestContext, installed_app: InstalledAppRef) -> dict[str, object]:
        file = request.files.get("file")
        audio = AudioUpload(stream=file.stream, mime_type=file.mimetype) if file is not None else None
        transcript = application_services().installed_app_audio.transcript_asr(installed_app=installed_app, audio=audio)
        return dump_response(AudioTranscriptResponse, transcript)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/text-to-audio",
    endpoint="installed_app_text",
)
class ChatTextApi(Resource):
    @console_ns.expect(console_ns.models[TextToAudioPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[AudioBinaryResponse.__name__])
    @console_account_admission()
    @get_installed_app
    @model_validate(TextToAudioPayload)
    @_audio_errors
    def post(
        self, payload: TextToAudioPayload, request_context: RequestContext, installed_app: InstalledAppRef
    ) -> Response | None:
        output = application_services().installed_app_audio.transcript_tts(
            installed_app=installed_app,
            account_id=request_context.account_id,
            text=payload.text,
            voice=payload.voice,
            message_id=payload.message_id,
        )
        # response-contract:ignore audio_binary_response
        if output is None:
            return None
        if isinstance(output.data, (bytes, bytearray, memoryview)):
            data = bytes(output.data)
            return Response(data, content_type=resolve_audio_mime_type(data, output.mime_type))
        audio_stream, mime_type = inspect_audio_stream(output.data, output.mime_type)
        response = Response(
            stream_with_context(audio_stream),  # pyrefly: ignore[no-matching-overload]
            content_type=mime_type,
        )
        response.call_on_close(audio_stream.close)
        return response
