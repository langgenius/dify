import io
import logging
import uuid
from collections.abc import Generator
from typing import cast

from flask import Response, stream_with_context
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage

from constants import AUDIO_EXTENSIONS
from core.app.apps.agent_app.app_feature_projection import merge_agent_app_features
from core.model_manager import ModelManager
from graphon.model_runtime.entities.model_entities import ModelType
from models.agent_config_entities import AgentSoulConfig
from models.enums import MessageStatus
from models.model import App, AppMode, Message, load_annotation_reply_config
from services.agent.roster_service import AgentRosterService
from services.app_ref_service import MessageRef
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)
from services.workflow_service import WorkflowService

FILE_SIZE = 30
FILE_SIZE_LIMIT = FILE_SIZE * 1024 * 1024

logger = logging.getLogger(__name__)


class AudioService:
    @staticmethod
    def _get_message_by_ref(session: Session, message_ref: MessageRef) -> Message | None:
        stmt = select(Message).where(Message.id == message_ref.message_id, Message.app_id == message_ref.app_id)
        if message_ref.end_user_id is not None:
            stmt = stmt.where(Message.from_end_user_id == message_ref.end_user_id)
        if message_ref.account_id is not None:
            stmt = stmt.where(Message.from_account_id == message_ref.account_id)
        return session.scalar(stmt.limit(1))

    @classmethod
    def transcript_asr(
        cls,
        app_model: App,
        file: FileStorage | None,
        *,
        session: Session,
        end_user: str | None = None,
    ) -> dict[str, str]:
        """Transcribe audio after enforcing the effective feature configuration.

        Published Agent Apps use their active Agent Soul. Historical Agent Apps
        without a backing roster Agent retain the legacy AppModelConfig fallback.

        Raises:
            SpeechToTextDisabledServiceError: If the effective feature configuration disables STT.
        """
        if app_model.mode == AppMode.AGENT:
            agent_soul = AgentRosterService(session).get_published_agent_soul_for_app(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
            )
            if agent_soul is not None:
                return cls.transcript_agent_asr(
                    app_model=app_model,
                    agent_soul=agent_soul,
                    file=file,
                    session=session,
                    end_user=end_user,
                )

        if app_model.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = app_model.workflow_with_session(session=session)
            if workflow is None:
                raise SpeechToTextDisabledServiceError()

            features_dict = workflow.features_dict
            if "speech_to_text" not in features_dict or not features_dict["speech_to_text"].get("enabled"):
                raise SpeechToTextDisabledServiceError()
        else:
            app_model_config = app_model.app_model_config_with_session(session=session)
            if not app_model_config:
                raise SpeechToTextDisabledServiceError()

            if not app_model_config.speech_to_text_dict["enabled"]:
                raise SpeechToTextDisabledServiceError()

        return cls._invoke_speech_to_text(app_model=app_model, file=file, end_user=end_user)

    @classmethod
    def transcript_agent_asr(
        cls,
        app_model: App,
        agent_soul: AgentSoulConfig,
        file: FileStorage | None,
        *,
        session: Session,
        end_user: str | None = None,
    ) -> dict[str, str]:
        """Transcribe Agent audio after applying Soul-first runtime feature projection.

        Raises:
            SpeechToTextDisabledServiceError: If the merged Agent feature configuration disables STT.
        """
        app_model_config = app_model.app_model_config_with_session(session=session)
        annotation_reply = load_annotation_reply_config(session, app_model.id) if app_model_config else None
        features = merge_agent_app_features(
            agent_soul=agent_soul,
            app_model_config=app_model_config,
            annotation_reply=annotation_reply,
        )
        if not features.get("speech_to_text", {}).get("enabled"):
            raise SpeechToTextDisabledServiceError()

        return cls._invoke_speech_to_text(app_model=app_model, file=file, end_user=end_user)

    @classmethod
    def _invoke_speech_to_text(
        cls, app_model: App, file: FileStorage | None, end_user: str | None = None
    ) -> dict[str, str]:
        if file is None:
            raise NoAudioUploadedServiceError()

        extension = file.mimetype
        if extension not in [f"audio/{ext}" for ext in AUDIO_EXTENSIONS]:
            raise UnsupportedAudioTypeServiceError()

        file_content = file.stream.read()
        file_size = len(file_content)

        if file_size > FILE_SIZE_LIMIT:
            message = f"Audio size larger than {FILE_SIZE} mb"
            raise AudioTooLargeServiceError(message)

        model_manager = ModelManager.for_tenant(tenant_id=app_model.tenant_id, user_id=end_user)
        model_instance = model_manager.get_default_model_instance(
            tenant_id=app_model.tenant_id, model_type=ModelType.SPEECH2TEXT
        )
        if model_instance is None:
            raise ProviderNotSupportSpeechToTextServiceError()

        buffer = io.BytesIO(file_content)
        buffer.name = "temp.mp3"

        return {"text": model_instance.invoke_speech2text(file=buffer)}

    @classmethod
    def transcript_tts(
        cls,
        app_model: App,
        *,
        session: Session,
        text: str | None = None,
        voice: str | None = None,
        end_user: str | None = None,
        message_ref: MessageRef | None = None,
        is_draft: bool = False,
    ):
        def invoke_tts(text_content: str, app_model: App, voice: str | None = None, is_draft: bool = False):
            if voice is None:
                if app_model.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
                    if is_draft:
                        workflow = WorkflowService().get_draft_workflow(app_model=app_model, session=session)
                    else:
                        workflow = app_model.workflow_with_session(session=session)
                    if (
                        workflow is None
                        or "text_to_speech" not in workflow.features_dict
                        or not workflow.features_dict["text_to_speech"].get("enabled")
                    ):
                        raise ValueError("TTS is not enabled")

                    voice = workflow.features_dict["text_to_speech"].get("voice")
                else:
                    if not is_draft:
                        app_model_config = app_model.app_model_config_with_session(session=session)
                        if app_model_config is None:
                            raise ValueError("AppModelConfig not found")
                        text_to_speech_dict = app_model_config.text_to_speech_dict

                        if not text_to_speech_dict.get("enabled"):
                            raise ValueError("TTS is not enabled")

                        voice = cast(str | None, text_to_speech_dict.get("voice"))

            model_manager = ModelManager.for_tenant(tenant_id=app_model.tenant_id, user_id=end_user)
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

                return model_instance.invoke_tts(content_text=text_content.strip(), voice=voice)
            except Exception as e:
                raise e

        if message_ref:
            try:
                uuid.UUID(message_ref.message_id)
            except ValueError:
                return None
            message = cls._get_message_by_ref(session, message_ref)
            if message is None:
                return None
            if message.answer == "" and message.status in {MessageStatus.NORMAL, MessageStatus.PAUSED}:
                return None

            else:
                response = invoke_tts(text_content=message.answer, app_model=app_model, voice=voice, is_draft=is_draft)
                if isinstance(response, Generator):
                    return Response(stream_with_context(response), content_type="audio/mpeg")  # type: ignore
                return response
        else:
            if text is None:
                raise ValueError("Text is required")
            response = invoke_tts(text_content=text, app_model=app_model, voice=voice, is_draft=is_draft)
            if isinstance(response, Generator):
                return Response(stream_with_context(response), content_type="audio/mpeg")  # type: ignore
            return response

    @classmethod
    def transcript_tts_voices(cls, tenant_id: str, language: str):
        model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
        model_instance = model_manager.get_default_model_instance(tenant_id=tenant_id, model_type=ModelType.TTS)
        if model_instance is None:
            raise ProviderNotSupportTextToSpeechServiceError()

        try:
            return model_instance.get_tts_voices(language)
        except Exception as e:
            raise e
