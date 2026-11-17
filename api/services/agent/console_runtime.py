"""Adapt Console Agent chat and audio to their existing generation engines."""

from collections.abc import Iterable, Mapping
from typing import Any, NamedTuple

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from machinery.context import RequestContext
from models.agent import AgentConfigDraftType
from models.model import App
from repositories.app.agent_runtime_app import (
    find_existing_agent_runtime_app,
    resolve_agent_runtime_app,
)
from repositories.app.console_repository import console_app_actor
from services.agent.composer_service import AgentComposerService
from services.agent.roster_service import AgentRosterService
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.app_generate_service import AppGenerateService
from services.app_ref_service import AppRefService
from services.audio_service import AudioService
from services.audio_types import AudioOutput, AudioUpload


class AgentConsoleConversationMissingError(Exception):
    """The supplied conversation does not identify the account's selected debug session."""


class AgentConsoleAudioTarget(NamedTuple):
    app_id: str
    agent_id: str


class AgentConsoleRuntime:
    """Own the ORM compatibility boundary for the Console Agent runtime."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        """Use independent, short sessions for admission lookups and runtime preparation."""
        self._sessions = session_factory

    @staticmethod
    def _require_app(session: Session, *, context: RequestContext, agent_id: str, materialize: bool) -> App:
        """Load the tenant's runtime App, optionally creating the hidden App for inline Agents."""
        tenant_id = context.active_workspace_id
        if materialize:
            app = resolve_agent_runtime_app(session, tenant_id=tenant_id, agent_id=agent_id)
        else:
            app = find_existing_agent_runtime_app(session, tenant_id=tenant_id, agent_id=agent_id)
        if app is None:
            raise AgentAppNotFoundError
        return app

    def resolve_audio_target(self, context: RequestContext, agent_id: str) -> AgentConsoleAudioTarget:
        """Resolve the runtime App before the controller checks its APP-scoped RBAC policy."""
        with self._sessions() as session:
            app = self._require_app(session, context=context, agent_id=agent_id, materialize=True)
            return AgentConsoleAudioTarget(app.id, agent_id)

    def require_existing_app(self, context: RequestContext, agent_id: str) -> None:
        """Require an existing App without creating runtime state for the read."""
        with self._sessions() as session:
            self._require_app(session, context=context, agent_id=agent_id, materialize=False)

    def require_runtime_app(self, context: RequestContext, agent_id: str) -> None:
        """Validate the runtime App and materialize hidden inline state when necessary."""
        with self._sessions() as session:
            self._require_app(session, context=context, agent_id=agent_id, materialize=True)

    def generate_chat(
        self,
        context: RequestContext,
        agent_id: str,
        *,
        args: dict[str, Any],
        draft_type: AgentConfigDraftType,
        conversation_id: str | None,
    ) -> Mapping[str, Any] | Iterable[str]:
        """Resolve the account's debug conversation and start generation before returning its stream."""
        tenant_id = context.active_workspace_id
        account_id = context.account_id
        with self._sessions(expire_on_commit=False) as session:
            app = self._require_app(session, context=context, agent_id=agent_id, materialize=True)
            roster = AgentRosterService(session)
            if draft_type == AgentConfigDraftType.DEBUG_BUILD:
                resolved = roster.get_or_create_build_conversation(
                    tenant_id=tenant_id, agent_id=agent_id, account_id=account_id
                )
            elif not conversation_id:
                resolved = roster.rotate_preview_conversation(
                    tenant_id=tenant_id, agent_id=agent_id, account_id=account_id
                )
            else:
                resolved = roster.get_current_preview_conversation(
                    tenant_id=tenant_id, agent_id=agent_id, account_id=account_id
                )
            if resolved is None or (conversation_id and conversation_id != resolved):
                raise AgentConsoleConversationMissingError
            account = console_app_actor(session, context)
            response = AppGenerateService.generate(
                app_model=app,
                user=account,
                args={**args, "conversation_id": resolved},
                invoke_from=InvokeFrom.DEBUGGER,
                session=session,
                streaming=True,
            )
            session.commit()
        return response

    def transcribe(
        self,
        context: RequestContext,
        target: AgentConsoleAudioTarget,
        *,
        draft_type: AgentConfigDraftType,
        audio: AudioUpload | None,
    ) -> dict[str, str]:
        """Resolve the same App and draft authorized by the caller before invoking ASR outside SQL."""
        with self._sessions(expire_on_commit=False) as session:
            app = self._require_app(session, context=context, agent_id=target.agent_id, materialize=False)
            if app.id != target.app_id:
                raise AgentAppNotFoundError
            soul = AgentComposerService.load_agent_soul_for_debug(
                session=session,
                tenant_id=context.active_workspace_id,
                agent_id=target.agent_id,
                account_id=context.account_id,
                draft_type=draft_type,
            )
            AudioService.prepare_agent_asr(app_model=app, agent_soul=soul, session=session)
        return AudioService.invoke_speech_to_text(app, audio)

    def synthesize(
        self, context: RequestContext, agent_id: str, *, text: str | None, voice: str | None, message_id: str | None
    ) -> AudioOutput | None:
        """Prepare the admitted account's message or text, then invoke TTS after releasing SQL."""
        with self._sessions(expire_on_commit=False) as session:
            app = self._require_app(session, context=context, agent_id=agent_id, materialize=False)
            message_ref = (
                AppRefService.create_message_ref(
                    AppRefService.create_app_ref(app), message_id, account_id=context.account_id
                )
                if message_id
                else None
            )
            prepared = AudioService.prepare_tts(
                app, session=session, text=text, voice=voice, message_ref=message_ref, is_draft=True
            )
        if prepared is None:
            return None
        return AudioService.invoke_tts(app, text=prepared.text, voice=prepared.voice)
