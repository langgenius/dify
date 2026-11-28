"""Adapt Console Agent chat to the existing generation engine."""

from collections.abc import Callable, Iterable, Mapping
from typing import Protocol

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from machinery.context import RequestContext
from models.account import Account
from models.agent import AgentConfigDraftType
from models.model import App
from repositories.agent.agent_runtime_app import resolve_agent_runtime_app
from repositories.app.console_repository import console_app_actor
from services.agent.agent_app_contracts import AgentAppNotFoundError
from services.agent.roster_service import AgentRosterService


class AgentConsoleConversationMissingError(Exception):
    """The supplied conversation does not identify the account's selected debug session."""


class AgentConsolePreviewDisabledError(Exception):
    """The deployment does not allow Agent preview runs."""


class _GenerateAgentChat(Protocol):
    def __call__(
        self,
        *,
        app_model: App,
        user: Account,
        args: Mapping[str, object],
        invoke_from: InvokeFrom,
        session: Session,
        streaming: bool,
    ) -> Mapping[str, object] | Iterable[str]:
        """Prepare generation in the caller's session and return its output for consumption."""
        ...


class AgentConsoleRuntime:
    """Own the ORM compatibility boundary for Console Agent chat generation."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        preview_enabled: Callable[[], bool],
        generate: _GenerateAgentChat,
    ) -> None:
        """Use the supplied sessions, deployment policy, and generation engine for debug runs."""
        self._sessions = session_factory
        self._preview_enabled = preview_enabled
        self._generate = generate

    def generate_chat(
        self,
        context: RequestContext,
        agent_id: str,
        *,
        args: Mapping[str, object],
        draft_type: AgentConfigDraftType,
        conversation_id: str | None,
    ) -> Mapping[str, object] | Iterable[str]:
        """Check preview eligibility, select the account's conversation, and commit generation preparation."""
        tenant_id = context.active_workspace_id
        account_id = context.account_id
        with self._sessions(expire_on_commit=False) as session:
            app = resolve_agent_runtime_app(session, tenant_id=tenant_id, agent_id=agent_id)
            if app is None:
                raise AgentAppNotFoundError
            if draft_type == AgentConfigDraftType.DRAFT and not self._preview_enabled():
                raise AgentConsolePreviewDisabledError
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
            response = self._generate(
                app_model=app,
                user=account,
                args={**args, "conversation_id": resolved},
                invoke_from=InvokeFrom.DEBUGGER,
                session=session,
                streaming=True,
            )
            session.commit()
        return response
