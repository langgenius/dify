"""Adapt Console Agent chat to the existing generation engine."""

from collections.abc import Iterable, Mapping
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from machinery.context import RequestContext
from models.agent import AgentConfigDraftType
from repositories.app.agent_runtime_app import resolve_agent_runtime_app
from repositories.app.console_repository import console_app_actor
from services.agent.roster_service import AgentRosterService
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.app_generate_service import AppGenerateService


class AgentConsoleConversationMissingError(Exception):
    """The supplied conversation does not identify the account's selected debug session."""


class AgentConsoleRuntime:
    """Own the ORM compatibility boundary for Console Agent chat generation."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        """Use the supplied session factory for debug conversation selection and generation."""
        self._sessions = session_factory

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
            app = resolve_agent_runtime_app(session, tenant_id=tenant_id, agent_id=agent_id)
            if app is None:
                raise AgentAppNotFoundError
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
