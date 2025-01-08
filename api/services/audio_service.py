import io
import logging
import uuid
from typing import Optional

from werkzeug.datastructures import FileStorage

from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from models.model import App, AppMode, AppModelConfig, Message
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechServiceError,
    UnsupportedAudioTypeServiceError,
)

FILE_SIZE = 30
FILE_SIZE_LIMIT = FILE_SIZE * 1024 * 1024
ALLOWED_EXTENSIONS = ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "amr"]

logger = logging.getLogger(__name__)


class AudioService:
    @classmethod
    def transcript_asr(cls, app_model: App, file: FileStorage, end_user: Optional[str] = None):
        if app_model.mode in {AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value}:
            workflow = app_model.workflow
            if workflow is None:
                raise ValueError("Speech to text is not enabled")

            features_dict = workflow.features_dict
            if "speech_to_text" not in features_dict or not features_dict["speech_to_text"].get("enabled"):
                raise ValueError("Speech to text is not enabled")
        else:
            app_model_config: AppModelConfig = app_model.app_model_config

            if not app_model_config.speech_to_text_dict["enabled"]:
                raise ValueError("Speech to text is not enabled")

        if file is None:
            raise NoAudioUploadedServiceError()

        extension = file.mimetype
        if extension not in [f"audio/{ext}" for ext in ALLOWED_EXTENSIONS]:
            raise UnsupportedAudioTypeServiceError()

        file_content = file.read()
        file_size = len(file_content)

        if file_size > FILE_SIZE_LIMIT:
            message = f"Audio size larger than {FILE_SIZE} mb"
            raise AudioTooLargeServiceError(message)

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=app_model.tenant_id, model_type=ModelType.SPEECH2TEXT
        )
        if model_instance is None:
            raise ProviderNotSupportSpeechToTextServiceError()

        buffer = io.BytesIO(file_content)
        buffer.name = "temp.mp3"

        return {"text": model_instance.invoke_speech2text(file=buffer, user=end_user)}

    @classmethod
    def transcript_tts(
        cls,
        app_model: App,
        text: Optional[str] = None,
        voice: Optional[str] = None,
        end_user: Optional[str] = None,
        message_id: Optional[str] = None,
    ):
        from collections.abc import Generator

        from flask import Response, stream_with_context

        from app import app
        from extensions.ext_database import db

        def invoke_tts(text_content: str, app_model, voice: Optional[str] = None):
            with app.app_context():
                if app_model.mode in {AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value}:
                    workflow = app_model.workflow
                    if workflow is None:
                        raise ValueError("TTS is not enabled")

                    features_dict = workflow.features_dict
                    if "text_to_speech" not in features_dict or not features_dict["text_to_speech"].get("enabled"):
                        raise ValueError("TTS is not enabled")

                    voice = features_dict["text_to_speech"].get("voice") if voice is None else voice
                else:
                    text_to_speech_dict = app_model.app_model_config.text_to_speech_dict

                    if not text_to_speech_dict.get("enabled"):
                        raise ValueError("TTS is not enabled")

                    voice = text_to_speech_dict.get("voice") if voice is None else voice

                model_manager = ModelManager()
                model_instance = model_manager.get_default_model_instance(
                    tenant_id=app_model.tenant_id, model_type=ModelType.TTS
                )
                try:
                    if not voice:
                        voices = model_instance.get_tts_voices()
                        if voices:
                            voice = voices[0].get("value")
                            if not voice:
                                raise ValueError("Sorry, no voice available.")
                        else:
                            raise ValueError("Sorry, no voice available.")

                    return model_instance.invoke_tts(
                        content_text=text_content.strip(), user=end_user, tenant_id=app_model.tenant_id, voice=voice
                    )
                except Exception as e:
                    raise e

        if message_id:
            try:
                uuid.UUID(message_id)
            except ValueError:
                return None
            message = db.session.query(Message).filter(Message.id == message_id).first()
            if message is None:
                return None
            if message.answer == "" and message.status == "normal":
                return None

            else:
                response = invoke_tts(message.answer, app_model=app_model, voice=voice)
                if isinstance(response, Generator):
                    return Response(stream_with_context(response), content_type="audio/mpeg")
                return response
        else:
            if text is None:
                raise ValueError("Text is required")
            response = invoke_tts(text, app_model, voice)
            if isinstance(response, Generator):
                return Response(stream_with_context(response), content_type="audio/mpeg")
            return response

    @classmethod
    def transcript_tts_voices(cls, tenant_id: str, language: str):
        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(tenant_id=tenant_id, model_type=ModelType.TTS)
        if model_instance is None:
            raise ProviderNotSupportTextToSpeechServiceError()

        try:
            return model_instance.get_tts_voices(language)
        except Exception as e:
            raise e
