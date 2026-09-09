"""Prepare installed-app audio in a session, then invoke the shared provider runtime."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.datastructures import FileStorage

from models import App, InstalledApp
from services.app_ref_service import AppRefService
from services.audio_service import AudioService
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_audio_service import AudioOutput, AudioUpload, InstalledAppAudio


class InstalledAppAudioRuntime(InstalledAppAudio):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def transcript_asr(self, *, installed_app: InstalledAppRef, audio: AudioUpload | None) -> dict[str, str]:
        with self._session_factory(expire_on_commit=False) as session:
            app = self._get_app(session=session, installed_app=installed_app)
            AudioService.prepare_asr(app, session=session)

        # Provider internals retain their existing scoped-session behavior.
        # The app/configuration session above is released before those lookups
        # and external calls; migrating provider persistence is a separate step.
        file = FileStorage(stream=audio.stream, content_type=audio.mime_type) if audio is not None else None
        return AudioService.invoke_speech_to_text(app, file, end_user=None)

    @override
    def transcript_tts(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        text: str | None,
        voice: str | None,
        message_id: str | None,
    ) -> AudioOutput | None:
        with self._session_factory(expire_on_commit=False) as session:
            app = self._get_app(session=session, installed_app=installed_app)
            message_ref = (
                AppRefService.create_message_ref(AppRefService.create_app_ref(app), message_id, account_id=account_id)
                if message_id
                else None
            )
            prepared = AudioService.prepare_tts(app, session=session, text=text, voice=voice, message_ref=message_ref)
        if prepared is None:
            return None
        data, mime_type = AudioService.invoke_tts(app, text=prepared.text, voice=prepared.voice, end_user=None)
        return AudioOutput(data=data, mime_type=mime_type)

    @staticmethod
    def _get_app(*, session: Session, installed_app: InstalledAppRef) -> App:
        app = session.scalar(
            select(App)
            .join(InstalledApp, InstalledApp.app_id == App.id)
            .where(
                InstalledApp.id == installed_app.id,
                InstalledApp.tenant_id == installed_app.tenant_id,
                InstalledApp.app_id == installed_app.app_id,
            )
        )
        if app is None:
            raise InstalledAppNotFoundError(f"Installed app {installed_app.id} no longer exists")
        return app
