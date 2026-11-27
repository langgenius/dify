"""Adapt Console Agent chat and Build chat finalization to the runtime engine."""

from collections.abc import Callable, Iterable, Mapping
from typing import Protocol

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from machinery.context import RequestContext
from models.account import Account
from models.agent import AgentConfigDraftType
from models.model import App
from repositories.app.agent_runtime_app import resolve_agent_runtime_app
from repositories.app.console_repository import console_app_actor
from services.agent.roster_service import AgentRosterService
from services.app.agent_app_contracts import AgentAppNotFoundError


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


class _FinalizeAgentBuildChat(Protocol):
    def __call__(
        self,
        *,
        session: Session,
        app_model: App,
        user: Account,
        conversation_id: str,
        external_trace_id: str | None = None,
    ) -> None:
        """Run finalization synchronously in the account's resolved Build conversation."""
        ...


class AgentConsoleRuntime:
    """Own the ORM compatibility boundary for Console Agent chat and finalization."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        preview_enabled: Callable[[], bool],
        generate: _GenerateAgentChat,
        finalize_build_chat: _FinalizeAgentBuildChat,
    ) -> None:
        """Use the supplied sessions, deployment policy, and execution entry points for debug runs."""
        self._sessions = session_factory
        self._preview_enabled = preview_enabled
        self._generate = generate
        self._finalize_build_chat = finalize_build_chat

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

    def finalize_build_chat(
        self, context: RequestContext, agent_id: str, *, external_trace_id: str | None = None
    ) -> None:
        """Finalize the admitted account's Build draft in its stable debug conversation.

        Raise AgentAppNotFoundError when the Agent has no available runtime App in the workspace.
        Commit the Build conversation mapping before invoking the engine. Engine errors propagate.
        """
        tenant_id = context.active_workspace_id
        account_id = context.account_id
        with self._sessions(expire_on_commit=False) as session:
            app = resolve_agent_runtime_app(session, tenant_id=tenant_id, agent_id=agent_id)
            if app is None:
                raise AgentAppNotFoundError
            resolved = AgentRosterService(session).get_or_create_build_conversation(
                tenant_id=tenant_id, agent_id=agent_id, account_id=account_id, commit=False
            )
            account = console_app_actor(session, context)
            session.commit()
            self._finalize_build_chat(
                session=session,
                app_model=app,
                user=account,
                conversation_id=resolved,
                external_trace_id=external_trace_id,
            )
