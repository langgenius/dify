import logging

from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field
from werkzeug.exceptions import InternalServerError

import services
from controllers.console import console_ns
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
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from libs.login import login_required
from models import App, AppMode
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    UnsupportedAudioTypeServiceError,
)

logger = logging.getLogger(__name__)
DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class TextToSpeechPayload(BaseModel):
    message_id: str | None = Field(default=None, description="Message ID")
    text: str = Field(..., description="Text to convert")
    voice: str | None = Field(default=None, description="Voice name")
    streaming: bool | None = Field(default=None, description="Whether to stream audio")


class TextToSpeechVoiceQuery(BaseModel):
    language: str = Field(..., description="Language code")


console_ns.schema_model(
    TextToSpeechPayload.__name__, TextToSpeechPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
)
console_ns.schema_model(
    TextToSpeechVoiceQuery.__name__,
    TextToSpeechVoiceQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@console_ns.route("/apps/<uuid:app_id>/audio-to-text")
class ChatMessageAudioApi(Resource):
    @console_ns.doc("chat_message_audio_transcript")
    @console_ns.doc(description="Transcript audio to text for chat messages")
    @console_ns.doc(params={"app_id": "App ID"})
    @console_ns.response(
        200,
        "Audio transcription successful",
        console_ns.model("AudioTranscriptResponse", {"text": fields.String(description="Transcribed text from audio")}),
    )
    @console_ns.response(400, "Bad request - No audio uploaded or unsupported type")
    @console_ns.response(413, "Audio file too large")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    def post(self, app_model):
        file = request.files["file"]

        try:
            response = AudioService.transcript_asr(
                app_model=app_model,
                file=file,
                end_user=None,
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
            logger.exception("Failed to handle post request to ChatMessageAudioApi")
            raise InternalServerError()


@console_ns.route("/apps/<uuid:app_id>/text-to-audio")
class ChatMessageTextApi(Resource):
    @console_ns.doc("chat_message_text_to_speech")
    @console_ns.doc(description="Convert text to speech for chat messages")
    @console_ns.doc(params={"app_id": "App ID"})
    @console_ns.expect(console_ns.models[TextToSpeechPayload.__name__])
    @console_ns.response(200, "Text to speech conversion successful")
    @console_ns.response(400, "Bad request - Invalid parameters")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_model: App):
        try:
            payload = TextToSpeechPayload.model_validate(console_ns.payload)

            response = AudioService.transcript_tts(
                app_model=app_model,
                text=payload.text,
                voice=payload.voice,
                message_id=payload.message_id,
                is_draft=True,
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
            logger.exception("Failed to handle post request to ChatMessageTextApi")
            raise InternalServerError()


@console_ns.route("/apps/<uuid:app_id>/text-to-audio/voices")
class TextModesApi(Resource):
    @console_ns.doc("get_text_to_speech_voices")
    @console_ns.doc(description="Get available TTS voices for a specific language")
    @console_ns.doc(params={"app_id": "App ID"})
    @console_ns.expect(console_ns.models[TextToSpeechVoiceQuery.__name__])
    @console_ns.response(
        200, "TTS voices retrieved successfully", fields.List(fields.Raw(description="Available voices"))
    )
    @console_ns.response(400, "Invalid language parameter")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_model):
        try:
            args = TextToSpeechVoiceQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

            response = AudioService.transcript_tts_voices(
                tenant_id=app_model.tenant_id,
                language=args.language,
            )

            return response
        except services.errors.audio.ProviderNotSupportTextToSpeechLanageServiceError:
            raise AppUnavailableError("Text to audio voices language parameter loss.")
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
            logger.exception("Failed to handle get request to TextModesApi")
            raise InternalServerError()
