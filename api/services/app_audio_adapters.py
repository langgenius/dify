"""Bridge app references to the shared audio configuration and provider owners.

AudioService still owns ORM configuration policy. Prepare with a bounded
session here, then release it before reading uploads or invoking providers.
"""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models import App
from models.agent import AgentConfigDraftType
from services import audio_provider_gateway
from services.agent.composer_service import AgentComposerService
from services.agent.errors import AgentNotFoundError, AgentVersionNotFoundError
from services.agent.roster_service import AgentRosterService
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.app_audio_service import AppAudio
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_ref_service import AppRefService
from services.audio_service import AudioService
from services.audio_types import AudioAppRef, AudioDraftType, AudioOutput, AudioUpload, AudioVoice
from services.entities.message_entities import MessageAccount, MessageActor, MessageEndUser


class AppAudioRuntime(AppAudio):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def transcript_asr(
        self, *, app: AudioAppRef, audio: AudioUpload | None, end_user: str | None = None
    ) -> dict[str, str]:
        with self._session_factory(expire_on_commit=False) as session:
            app_model = self._get_app(session=session, app=app)
            AudioService.prepare_asr(app_model, session=session)

        return AudioService.invoke_speech_to_text(app_model, audio, end_user=end_user)

    @override
    def transcript_agent_asr(
        self,
        *,
        app: AudioAppRef,
        agent_id: str,
        actor: MessageAccount,
        draft_type: AudioDraftType,
        audio: AudioUpload | None,
    ) -> dict[str, str]:
        try:
            with self._session_factory(expire_on_commit=False) as session:
                app_model = AgentRosterService(session).get_existing_agent_runtime_app_model(
                    tenant_id=app.tenant_id, agent_id=agent_id
                )
                if app_model.id != app.app_id or app_model.mode != app.app_mode:
                    raise AppDefinitionUnavailableError(f"Agent {agent_id} runtime app changed after admission")
                agent_soul = AgentComposerService.load_agent_soul_for_debug(
                    session=session,
                    tenant_id=app.tenant_id,
                    agent_id=agent_id,
                    account_id=actor.account_id,
                    draft_type=AgentConfigDraftType(draft_type),
                )
                AudioService.prepare_agent_asr(app_model=app_model, agent_soul=agent_soul, session=session)
        except (AgentNotFoundError, AgentVersionNotFoundError) as error:
            raise AgentAppNotFoundError(error.description) from error

        return AudioService.invoke_speech_to_text(app_model, audio)

    @override
    def transcript_tts(
        self,
        *,
        app: AudioAppRef,
        actor: MessageActor,
        text: str | None,
        voice: str | None,
        message_id: str | None,
        end_user: str | None = None,
        is_draft: bool = False,
    ) -> AudioOutput | None:
        with self._session_factory(expire_on_commit=False) as session:
            app_model = self._get_app(session=session, app=app)
            message_ref = (
                AppRefService.create_message_ref(
                    AppRefService.create_app_ref(app_model),
                    message_id,
                    account_id=actor.account_id if isinstance(actor, MessageAccount) else None,
                    end_user_id=actor.end_user_id if isinstance(actor, MessageEndUser) else None,
                )
                if message_id
                else None
            )
            prepared = AudioService.prepare_tts(
                app_model, session=session, text=text, voice=voice, message_ref=message_ref, is_draft=is_draft
            )

        if prepared is None:
            return None
        return AudioService.invoke_tts(app_model, text=prepared.text, voice=prepared.voice, end_user=end_user)

    @override
    def get_voices(self, *, tenant_id: str, language: str) -> list[AudioVoice]:
        return audio_provider_gateway.get_voices(tenant_id=tenant_id, language=language)

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
