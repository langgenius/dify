"""Shared audio policy and compatibility entry points for existing callers.

TODO: Migrate configuration reads with the Agent/Workflow query owners before
replacing these entry points. Keep feature precedence and message eligibility
here so the InstalledApp runtime and legacy callers share one implementation.
Provider SDK calls use the plain values in audio_types.
"""

import logging
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import cast

from flask import Response, stream_with_context
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage

from constants import AUDIO_EXTENSIONS
from core.app.apps.agent_app.app_feature_projection import merge_agent_app_features
from core.base.tts.audio_mime import inspect_audio_stream, resolve_audio_mime_type
from graphon.model_runtime.protocols.tts_runtime import TTSModelVoice
from models.agent_config_entities import AgentSoulConfig
from models.enums import MessageStatus
from models.model import App, AppMode, Message, load_annotation_reply_config
from services import audio_provider_gateway
from services.agent.roster_service import AgentRosterService
from services.app_ref_service import MessageRef
from services.audio_types import AudioAppRef, AudioOutput, AudioUpload
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)
from services.workflow_service import WorkflowService

FILE_SIZE = 30
FILE_SIZE_LIMIT = FILE_SIZE * 1024 * 1024
_ASR_MIME_TYPE_ALIASES = {
    "audio/x-m4a": "audio/m4a",
}

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class PreparedTextToAudio:
    """Message text and configured voice resolved before contacting a provider."""

    text: str
    voice: str | None


def _create_tts_response(
    audio: Iterable[bytes] | bytes | bytearray | memoryview, declared_mime_type: str | None
) -> Response:
    """Create a response whose Content-Type matches the returned audio container."""
    if isinstance(audio, (bytes, bytearray, memoryview)):
        audio_bytes = bytes(audio)
        return Response(audio_bytes, content_type=resolve_audio_mime_type(audio_bytes, declared_mime_type))

    audio_stream, mime_type = inspect_audio_stream(audio, declared_mime_type)
    response = Response(
        stream_with_context(audio_stream),  # pyrefly: ignore[no-matching-overload]
        content_type=mime_type,
    )
    response.call_on_close(audio_stream.close)
    return response


class AudioService:
    @staticmethod
    def _get_message_by_ref(session: Session, message_ref: MessageRef) -> Message | None:
        stmt = select(Message).where(
            Message.id == message_ref.message_id,
            Message.app_id == message_ref.app.app_id,
        )
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
        cls.prepare_asr(app_model, session=session)
        return cls.invoke_speech_to_text(
            app_model=app_model,
            audio=AudioUpload(stream=file.stream, mime_type=file.mimetype) if file is not None else None,
            end_user=end_user,
        )

    @classmethod
    def prepare_asr(cls, app_model: App, *, session: Session) -> None:
        """Validate the effective published ASR feature using the caller's session."""
        if app_model.mode == AppMode.AGENT:
            agent_soul = AgentRosterService(session).get_published_agent_soul_for_app(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
            )
            if agent_soul is not None:
                cls._prepare_agent_asr(
                    app_model=app_model,
                    agent_soul=agent_soul,
                    session=session,
                )
                return

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
        cls._prepare_agent_asr(app_model=app_model, agent_soul=agent_soul, session=session)
        return cls.invoke_speech_to_text(
            app_model=app_model,
            audio=AudioUpload(stream=file.stream, mime_type=file.mimetype) if file is not None else None,
            end_user=end_user,
        )

    @staticmethod
    def _prepare_agent_asr(app_model: App, agent_soul: AgentSoulConfig, *, session: Session) -> None:
        app_model_config = app_model.app_model_config_with_session(session=session)
        annotation_reply = load_annotation_reply_config(session, app_model.id) if app_model_config else None
        features = merge_agent_app_features(
            agent_soul=agent_soul,
            app_model_config=app_model_config,
            annotation_reply=annotation_reply,
        )
        if not features.get("speech_to_text", {}).get("enabled"):
            raise SpeechToTextDisabledServiceError()

    @classmethod
    def invoke_speech_to_text(
        cls, app_model: App, audio: AudioUpload | None, *, end_user: str | None = None
    ) -> dict[str, str]:
        """Validate the upload and invoke ASR after application configuration is resolved."""
        if audio is None:
            raise NoAudioUploadedServiceError()

        mimetype = _ASR_MIME_TYPE_ALIASES.get(audio.mime_type, audio.mime_type)
        if mimetype not in [f"audio/{ext}" for ext in AUDIO_EXTENSIONS]:
            raise UnsupportedAudioTypeServiceError()

        file_content = audio.stream.read()
        file_size = len(file_content)

        if file_size > FILE_SIZE_LIMIT:
            message = f"Audio size larger than {FILE_SIZE} mb"
            raise AudioTooLargeServiceError(message)

        app_ref = AudioAppRef(app_id=app_model.id, tenant_id=app_model.tenant_id, app_mode=app_model.mode.value)
        return {"text": audio_provider_gateway.speech_to_text(app=app_ref, content=file_content, end_user=end_user)}

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
    ) -> Response | None:
        prepared = cls.prepare_tts(
            app_model,
            session=session,
            text=text,
            voice=voice,
            message_ref=message_ref,
            is_draft=is_draft,
        )
        if prepared is None:
            return None
        output = cls.invoke_tts(app_model, text=prepared.text, voice=prepared.voice, end_user=end_user)
        return _create_tts_response(output.data, output.mime_type)

    @classmethod
    def prepare_tts(
        cls,
        app_model: App,
        *,
        session: Session,
        text: str | None = None,
        voice: str | None = None,
        message_ref: MessageRef | None = None,
        is_draft: bool = False,
    ) -> PreparedTextToAudio | None:
        """Resolve owned message text and configured voice without invoking TTS."""
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
            text = message.answer
        elif text is None:
            raise ValueError("Text is required")

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
            elif not is_draft:
                app_model_config = app_model.app_model_config_with_session(session=session)
                if app_model_config is None:
                    raise ValueError("AppModelConfig not found")
                text_to_speech_dict = app_model_config.text_to_speech_dict

                if not text_to_speech_dict.get("enabled"):
                    raise ValueError("TTS is not enabled")

                voice = cast(str | None, text_to_speech_dict.get("voice"))

        return PreparedTextToAudio(text=text, voice=voice)

    @classmethod
    def invoke_tts(
        cls,
        app_model: App,
        *,
        text: str,
        voice: str | None,
        end_user: str | None = None,
    ) -> AudioOutput:
        """Invoke the provider using text and voice resolved by preparation."""
        app_ref = AudioAppRef(app_id=app_model.id, tenant_id=app_model.tenant_id, app_mode=app_model.mode.value)
        return audio_provider_gateway.text_to_speech(app=app_ref, text=text.strip(), voice=voice, end_user=end_user)

    @classmethod
    def transcript_tts_voices(cls, tenant_id: str, language: str) -> list[TTSModelVoice]:
        return audio_provider_gateway.get_voices(tenant_id=tenant_id, language=language)
