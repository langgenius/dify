import logging

from flask import request
from flask_restx import Resource, fields, reqparse
from werkzeug.exceptions import InternalServerError

import services
from controllers.console import api, console_ns
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


@console_ns.route("/apps/<uuid:app_id>/audio-to-text")
class ChatMessageAudioApi(Resource):
    @api.doc("chat_message_audio_transcript")
    @api.doc(description="Transcript audio to text for chat messages")
    @api.doc(params={"app_id": "App ID"})
    @api.response(
        200,
        "Audio transcription successful",
        api.model("AudioTranscriptResponse", {"text": fields.String(description="Transcribed text from audio")}),
    )
    @api.response(400, "Bad request - No audio uploaded or unsupported type")
    @api.response(413, "Audio file too large")
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
    @api.doc("chat_message_text_to_speech")
    @api.doc(description="Convert text to speech for chat messages")
    @api.doc(params={"app_id": "App ID"})
    @api.expect(
        api.model(
            "TextToSpeechRequest",
            {
                "message_id": fields.String(description="Message ID"),
                "text": fields.String(required=True, description="Text to convert to speech"),
                "voice": fields.String(description="Voice to use for TTS"),
                "streaming": fields.Boolean(description="Whether to stream the audio"),
            },
        )
    )
    @api.response(200, "Text to speech conversion successful")
    @api.response(400, "Bad request - Invalid parameters")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_model: App):
        try:
            parser = (
                reqparse.RequestParser()
                .add_argument("message_id", type=str, location="json")
                .add_argument("text", type=str, location="json")
                .add_argument("voice", type=str, location="json")
                .add_argument("streaming", type=bool, location="json")
            )
            args = parser.parse_args()

            message_id = args.get("message_id", None)
            text = args.get("text", None)
            voice = args.get("voice", None)

            response = AudioService.transcript_tts(
                app_model=app_model, text=text, voice=voice, message_id=message_id, is_draft=True
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
    @api.doc("get_text_to_speech_voices")
    @api.doc(description="Get available TTS voices for a specific language")
    @api.doc(params={"app_id": "App ID"})
    @api.expect(api.parser().add_argument("language", type=str, required=True, location="args", help="Language code"))
    @api.response(200, "TTS voices retrieved successfully", fields.List(fields.Raw(description="Available voices")))
    @api.response(400, "Invalid language parameter")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_model):
        try:
            parser = reqparse.RequestParser().add_argument("language", type=str, required=True, location="args")
            args = parser.parse_args()

            response = AudioService.transcript_tts_voices(
                tenant_id=app_model.tenant_id,
                language=args["language"],
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
