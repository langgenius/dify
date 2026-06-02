"""Conversation-keyed Agent backend session store for the Agent App type.

Shares the unified ``agent_runtime_sessions`` table with the workflow Agent
Node store, but owns rows with ``owner_type = conversation``: one Agent App
conversation maps to one Agent session, so multi-turn chat re-enters the same
``session_snapshot``. Cross-conversation memory (PRD Global / Per app) is a
phase-2 concern and not modeled here.
"""

from __future__ import annotations

from dataclasses import dataclass

from agenton.compositor import CompositorSessionSnapshot
from sqlalchemy import select

from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from models.agent import (
    AgentRuntimeSession,
    AgentRuntimeSessionOwnerType,
    AgentRuntimeSessionStatus,
)


@dataclass(frozen=True, slots=True)
class AgentAppSessionScope:
    """Identity of one Agent App conversation session."""

    tenant_id: str
    app_id: str
    conversation_id: str
    agent_id: str
    agent_config_snapshot_id: str


class AgentAppRuntimeSessionStore:
    """Persists Agent backend session snapshots for Agent App conversations."""

    def load_active_snapshot(self, scope: AgentAppSessionScope) -> CompositorSessionSnapshot | None:
        with session_factory.create_session() as session:
            row = session.scalar(self._active_stmt(scope))
            if row is None:
                return None
            return CompositorSessionSnapshot.model_validate_json(row.session_snapshot)

    def save_active_snapshot(
        self,
        *,
        scope: AgentAppSessionScope,
        backend_run_id: str,
        snapshot: CompositorSessionSnapshot | None,
    ) -> None:
        if snapshot is None:
            return
        snapshot_json = snapshot.model_dump_json()
        with session_factory.create_session() as session:
            row = session.scalar(self._scope_stmt(scope))
            if row is None:
                row = AgentRuntimeSession(
                    tenant_id=scope.tenant_id,
                    app_id=scope.app_id,
                    owner_type=AgentRuntimeSessionOwnerType.CONVERSATION,
                    agent_id=scope.agent_id,
                    agent_config_snapshot_id=scope.agent_config_snapshot_id,
                    conversation_id=scope.conversation_id,
                    backend_run_id=backend_run_id,
                    session_snapshot=snapshot_json,
                    composition_layer_specs="[]",
                    status=AgentRuntimeSessionStatus.ACTIVE,
                )
                session.add(row)
            else:
                row.backend_run_id = backend_run_id
                row.session_snapshot = snapshot_json
                row.status = AgentRuntimeSessionStatus.ACTIVE
                row.cleaned_at = None
            session.commit()

    def mark_cleaned(self, *, scope: AgentAppSessionScope, backend_run_id: str | None = None) -> None:
        with session_factory.create_session() as session:
            row = session.scalar(self._active_stmt(scope))
            if row is None:
                return
            if backend_run_id is not None:
                row.backend_run_id = backend_run_id
            row.status = AgentRuntimeSessionStatus.CLEANED
            row.cleaned_at = naive_utc_now()
            session.commit()

    @staticmethod
    def _scope_stmt(scope: AgentAppSessionScope):
        return select(AgentRuntimeSession).where(
            AgentRuntimeSession.owner_type == AgentRuntimeSessionOwnerType.CONVERSATION,
            AgentRuntimeSession.tenant_id == scope.tenant_id,
            AgentRuntimeSession.conversation_id == scope.conversation_id,
            AgentRuntimeSession.agent_id == scope.agent_id,
            AgentRuntimeSession.agent_config_snapshot_id == scope.agent_config_snapshot_id,
        )

    @classmethod
    def _active_stmt(cls, scope: AgentAppSessionScope):
        return cls._scope_stmt(scope).where(AgentRuntimeSession.status == AgentRuntimeSessionStatus.ACTIVE)


__all__ = ["AgentAppRuntimeSessionStore", "AgentAppSessionScope"]
