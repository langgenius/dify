import logging

import services
from controllers.service_api_with_auth import api
from controllers.service_api_with_auth.app.error import (
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
from controllers.service_api_with_auth.wraps import validate_app_token
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from flask import request
from flask_restful import Resource, reqparse  # type: ignore
from models.model import App, AppMode, EndUser
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    UnsupportedAudioTypeServiceError,
)
from werkzeug.exceptions import InternalServerError


class AudioApi(Resource):
    @validate_app_token
    def post(self, app_model: App, end_user: EndUser):
        """Transcribe audio to text.
        ---
        tags:
          - service/audio
        summary: Transcribe audio
        description: Convert audio file to text using speech-to-text
        security:
          - ApiKeyAuth: []
        consumes:
          - multipart/form-data
        parameters:
          - name: file
            in: formData
            required: true
            type: file
            description: The audio file to transcribe
        responses:
          200:
            description: Audio transcribed successfully
            schema:
              type: object
              properties:
                text:
                  type: string
                  description: Transcribed text
          400:
            description: Invalid request, no audio uploaded, or unsupported audio type
          401:
            description: Invalid or missing token
          413:
            description: Audio file too large
          500:
            description: Provider error or internal server error
        """
        file = request.files["file"]

        try:
            response = AudioService.transcript_asr(app_model=app_model, file=file, end_user=end_user)

            return response
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logging.exception("App model config broken.")
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
            logging.exception("internal server error.")
            raise InternalServerError()


class TextApi(Resource):
    @validate_app_token
    def post(self, app_model: App, end_user: EndUser):
        """Convert text to speech.
        ---
        tags:
          - service/audio
        summary: Text to speech
        description: Convert text to speech audio
        security:
          - ApiKeyAuth: []
        parameters:
          - name: body
            in: body
            required: true
            schema:
              type: object
              required:
                - text
              properties:
                text:
                  type: string
                  description: Text to convert to speech
                voice:
                  type: string
                  description: Voice ID to use for speech synthesis
                streaming:
                  type: boolean
                  default: false
                  description: Whether to stream the audio response
        responses:
          200:
            description: Text converted to speech successfully
            schema:
              type: object
              properties:
                audio_url:
                  type: string
                  description: URL to the generated audio file
          400:
            description: Invalid request
          401:
            description: Invalid or missing token
          500:
            description: Provider error or internal server error
        """
        try:
            parser = reqparse.RequestParser()
            parser.add_argument("message_id", type=str, required=False, location="json")
            parser.add_argument("voice", type=str, location="json")
            parser.add_argument("text", type=str, location="json")
            parser.add_argument("streaming", type=bool, location="json")
            args = parser.parse_args()

            message_id = args.get("message_id", None)
            text = args.get("text", None)
            if (
                app_model.mode in {AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value}
                and app_model.workflow
                and app_model.workflow.features_dict
            ):
                text_to_speech = app_model.workflow.features_dict.get("text_to_speech", {})
                voice = args.get("voice") or text_to_speech.get("voice")
            else:
                try:
                    voice = args.get("voice") or (
                        app_model.app_model_config.text_to_speech_dict.get("voice")
                        if app_model.app_model_config
                        else None
                    )
                except Exception:
                    voice = None
            response = AudioService.transcript_tts(
                app_model=app_model, message_id=message_id, end_user=end_user.external_user_id, voice=voice, text=text
            )

            return response
        except services.errors.app_model_config.AppModelConfigBrokenError:
            logging.exception("App model config broken.")
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
            logging.exception("internal server error.")
            raise InternalServerError()


api.add_resource(AudioApi, "/audio-to-text")
api.add_resource(TextApi, "/text-to-audio")
