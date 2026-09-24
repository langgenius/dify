"""Bridge app references to the shared audio configuration and provider owners.

AudioService still owns ORM configuration policy. Prepare with a bounded
session here, then release it before reading uploads or invoking providers.
"""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models import App
from services.app_audio_service import AppAudio
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_ref_service import AppRefService
from services.audio_service import AudioService
from services.audio_types import AudioAppRef, AudioOutput, AudioUpload


class AppAudioRuntime(AppAudio):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def transcript_asr(self, *, app: AudioAppRef, audio: AudioUpload | None) -> dict[str, str]:
        with self._session_factory(expire_on_commit=False) as session:
            app_model = self._get_app(session=session, app=app)
            AudioService.prepare_asr(app_model, session=session)

        return AudioService.invoke_speech_to_text(app_model, audio, end_user=None)

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
        return AudioService.invoke_tts(app_model, text=prepared.text, voice=prepared.voice, end_user=None)

    @staticmethod
    def _get_app(*, session: Session, app: AudioAppRef) -> App:
        app_model = session.scalar(select(App).where(App.id == app.app_id, App.tenant_id == app.tenant_id))
        if app_model is None:
            raise AppDefinitionUnavailableError(f"App {app.app_id} no longer exists in tenant {app.tenant_id}")
        if app_model.mode != app.app_mode:
            raise AppDefinitionUnavailableError(
                f"App {app.app_id} mode changed from {app.app_mode} to {app_model.mode} after admission"
            )
        return app_model
