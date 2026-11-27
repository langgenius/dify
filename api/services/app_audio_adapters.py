"""Bridge app references to the shared audio configuration and provider owners.

Agent configuration is read through its store. The legacy generic App paths
still prepare with a bounded session before reading uploads or invoking providers.
"""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models import App
from services import audio_provider_gateway
from services.app_audio_service import AgentAudioStore, AppAudio
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_ref_service import AppRefService
from services.audio_service import AudioService
from services.audio_types import AudioAppRef, AudioOutput, AudioUpload, AudioVoice
from services.errors.audio import SpeechToTextDisabledServiceError


class AppAudioRuntime(AppAudio):
    def __init__(self, *, session_factory: sessionmaker[Session], agent_audio: AgentAudioStore) -> None:
        """Inject the Agent read port and the session factory for legacy App preparation."""
        self._session_factory: sessionmaker[Session] = session_factory
        self._agent_audio = agent_audio

    @override
    def transcript_asr(self, *, app: AudioAppRef, audio: AudioUpload | None) -> dict[str, str]:
        with self._session_factory(expire_on_commit=False) as session:
            app_model = self._get_app(session=session, app=app)
            AudioService.prepare_asr(app_model, session=session)

        return AudioService.invoke_speech_to_text(app, audio, end_user=None)

    @override
    def transcript_agent_asr(
        self,
        *,
        app: AudioAppRef,
        agent_id: str,
        account_id: str,
        build: bool,
        audio: AudioUpload | None,
    ) -> dict[str, str]:
        """Invoke ASR only when the admitted App and selected debug draft allow it."""
        if not self._agent_audio.get_agent_asr_enabled(app=app, agent_id=agent_id, account_id=account_id, build=build):
            raise SpeechToTextDisabledServiceError()
        return AudioService.invoke_speech_to_text(app, audio)

    @override
    def transcript_tts(
        self,
        *,
        app: AudioAppRef,
        account_id: str,
        text: str | None,
        voice: str | None,
        message_id: str | None,
    ) -> AudioOutput | None:
        """Synthesize audio using the admitted App's published configuration."""
        with self._session_factory(expire_on_commit=False) as session:
            app_model = self._get_app(session=session, app=app)
            message_ref = (
                AppRefService.create_message_ref(
                    AppRefService.create_app_ref(app_model), message_id, account_id=account_id
                )
                if message_id
                else None
            )
            prepared = AudioService.prepare_tts(
                app_model, session=session, text=text, voice=voice, message_ref=message_ref
            )

        if prepared is None:
            return None
        return AudioService.invoke_tts(app, text=prepared.text, voice=prepared.voice, end_user=None)

    @override
    def transcript_agent_tts(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        text: str | None,
        voice: str | None,
        message_id: str | None,
    ) -> AudioOutput | None:
        """Synthesize an owned answer or preview text using the existing Agent App."""
        source = self._agent_audio.get_agent_tts_source(
            tenant_id=tenant_id, agent_id=agent_id, account_id=account_id, message_id=message_id
        )
        if message_id:
            text = source.message_answer
            if text is None:
                return None
        elif text is None:
            raise ValueError("Text is required")
        return AudioService.invoke_tts(source.app, text=text, voice=voice)

    @override
    def get_voices(self, *, tenant_id: str, language: str) -> list[AudioVoice]:
        """Return the available voices without exposing provider-specific types."""
        voices = audio_provider_gateway.get_voices(tenant_id=tenant_id, language=language)
        return [AudioVoice(name=voice["name"], value=voice["value"]) for voice in voices]

    @staticmethod
    def _get_app(*, session: Session, app: AudioAppRef) -> App:
        """Require the App's tenant and mode to still match its admitted reference."""
        app_model = session.scalar(select(App).where(App.id == app.app_id, App.tenant_id == app.tenant_id))
        if app_model is None:
            raise AppDefinitionUnavailableError(f"App {app.app_id} no longer exists in tenant {app.tenant_id}")
        if app_model.mode != app.app_mode:
            raise AppDefinitionUnavailableError(
                f"App {app.app_id} mode changed from {app.app_mode} to {app_model.mode} after admission"
            )
        return app_model
