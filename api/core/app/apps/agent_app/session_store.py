"""Conversation-keyed Agent backend session store for the Agent App type.

Shares the unified ``agent_runtime_sessions`` table with the workflow Agent
Node store, but owns rows with ``owner_type = conversation``: one Agent App
conversation maps to one Agent session, so multi-turn chat re-enters the same
``session_snapshot``. Cross-conversation memory (PRD Global / Per app) is a
phase-2 concern and not modeled here.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol import RuntimeLayerSpec
from pydantic import TypeAdapter
from sqlalchemy import select

from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from models.agent import (
    AgentRuntimeSession,
    AgentRuntimeSessionOwnerType,
    AgentRuntimeSessionStatus,
)

_RUNTIME_LAYER_SPECS_ADAPTER: TypeAdapter[list[RuntimeLayerSpec]] = TypeAdapter(list[RuntimeLayerSpec])


def _serialize_runtime_layer_specs(specs: list[RuntimeLayerSpec]) -> str:
    return _RUNTIME_LAYER_SPECS_ADAPTER.dump_json(specs).decode()


def _deserialize_runtime_layer_specs(value: str | None) -> list[RuntimeLayerSpec]:
    if not value:
        return []
    return _RUNTIME_LAYER_SPECS_ADAPTER.validate_json(value)


@dataclass(frozen=True, slots=True)
class AgentAppSessionScope:
    """Identity of one Agent App conversation session."""

    tenant_id: str
    app_id: str
    conversation_id: str
    agent_id: str
    agent_config_snapshot_id: str | None


@dataclass(frozen=True, slots=True)
class StoredAgentAppSession:
    """Persisted Agent App conversation session with reusable runtime specs."""

    scope: AgentAppSessionScope
    session_snapshot: CompositorSessionSnapshot
    backend_run_id: str | None
    runtime_layer_specs: list[RuntimeLayerSpec] = field(default_factory=list)
    # ENG-635: set while the conversation turn is paused on a dify.ask_human
    # deferred call, awaiting a HITL form submission.
    pending_form_id: str | None = None
    pending_tool_call_id: str | None = None


class AgentAppRuntimeSessionStore:
    """Persists Agent backend session snapshots for Agent App conversations."""

    def load_active_snapshot(self, scope: AgentAppSessionScope) -> CompositorSessionSnapshot | None:
        stored = self.load_active_session(scope)
        return stored.session_snapshot if stored is not None else None

    def load_active_session(self, scope: AgentAppSessionScope) -> StoredAgentAppSession | None:
        with session_factory.create_session() as session:
            row = session.scalar(self._active_stmt(scope))
            if row is None:
                return None
            return StoredAgentAppSession(
                scope=scope,
                session_snapshot=CompositorSessionSnapshot.model_validate_json(row.session_snapshot),
                backend_run_id=row.backend_run_id,
                runtime_layer_specs=_deserialize_runtime_layer_specs(row.composition_layer_specs),
                pending_form_id=row.pending_form_id,
                pending_tool_call_id=row.pending_tool_call_id,
            )

    def load_active_session_for_conversation(
        self, *, tenant_id: str, app_id: str, conversation_id: str
    ) -> StoredAgentAppSession | None:
        """Load the latest ACTIVE session for one conversation-level sandbox lookup.

        Sandbox inspection only knows the product locator
        ``tenant_id + app_id + conversation_id``; it does not know which
        ``agent_id`` or Agent Soul snapshot produced the active shell session.
        This method therefore resolves the newest ACTIVE conversation-owned row
        for that conversation and returns both the resumable snapshot and the
        persisted non-sensitive runtime layer specs needed to build a
        ``SandboxLocator``.
        """
        stmt = (
            select(AgentRuntimeSession)
            .where(
                AgentRuntimeSession.owner_type == AgentRuntimeSessionOwnerType.CONVERSATION,
                AgentRuntimeSession.tenant_id == tenant_id,
                AgentRuntimeSession.app_id == app_id,
                AgentRuntimeSession.conversation_id == conversation_id,
                AgentRuntimeSession.status == AgentRuntimeSessionStatus.ACTIVE,
            )
            .order_by(AgentRuntimeSession.updated_at.desc())
        )
        with session_factory.create_session() as session:
            row = session.scalar(stmt)
            if row is None:
                return None
            return StoredAgentAppSession(
                scope=AgentAppSessionScope(
                    tenant_id=row.tenant_id,
                    app_id=row.app_id,
                    conversation_id=row.conversation_id or "",
                    agent_id=row.agent_id,
                    agent_config_snapshot_id=row.agent_config_snapshot_id or "",
                ),
                session_snapshot=CompositorSessionSnapshot.model_validate_json(row.session_snapshot),
                backend_run_id=row.backend_run_id,
                runtime_layer_specs=_deserialize_runtime_layer_specs(row.composition_layer_specs),
            )

    def save_active_snapshot(
        self,
        *,
        scope: AgentAppSessionScope,
        backend_run_id: str,
        snapshot: CompositorSessionSnapshot | None,
        runtime_layer_specs: list[RuntimeLayerSpec],
        pending_form_id: str | None = None,
        pending_tool_call_id: str | None = None,
    ) -> None:
        if snapshot is None:
            return
        snapshot_json = snapshot.model_dump_json()
        runtime_layer_specs_json = _serialize_runtime_layer_specs(runtime_layer_specs)
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
                    composition_layer_specs=runtime_layer_specs_json,
                    status=AgentRuntimeSessionStatus.ACTIVE,
                    pending_form_id=pending_form_id,
                    pending_tool_call_id=pending_tool_call_id,
                )
                session.add(row)
            else:
                row.backend_run_id = backend_run_id
                row.session_snapshot = snapshot_json
                row.composition_layer_specs = runtime_layer_specs_json
                row.status = AgentRuntimeSessionStatus.ACTIVE
                row.cleaned_at = None
                # Set (or clear, when omitted) the ask_human pause correlation.
                row.pending_form_id = pending_form_id
                row.pending_tool_call_id = pending_tool_call_id
            session.flush()
            other_rows = session.scalars(
                select(AgentRuntimeSession).where(
                    AgentRuntimeSession.owner_type == AgentRuntimeSessionOwnerType.CONVERSATION,
                    AgentRuntimeSession.tenant_id == scope.tenant_id,
                    AgentRuntimeSession.app_id == scope.app_id,
                    AgentRuntimeSession.conversation_id == scope.conversation_id,
                    AgentRuntimeSession.status == AgentRuntimeSessionStatus.ACTIVE,
                    AgentRuntimeSession.id != row.id,
                )
            ).all()
            for other_row in other_rows:
                other_row.status = AgentRuntimeSessionStatus.CLEANED
                other_row.cleaned_at = naive_utc_now()
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
        stmt = select(AgentRuntimeSession).where(
            AgentRuntimeSession.owner_type == AgentRuntimeSessionOwnerType.CONVERSATION,
            AgentRuntimeSession.tenant_id == scope.tenant_id,
            AgentRuntimeSession.conversation_id == scope.conversation_id,
            AgentRuntimeSession.agent_id == scope.agent_id,
        )
        if scope.agent_config_snapshot_id is None:
            return stmt.where(AgentRuntimeSession.agent_config_snapshot_id.is_(None))
        return stmt.where(AgentRuntimeSession.agent_config_snapshot_id == scope.agent_config_snapshot_id)

    @classmethod
    def _active_stmt(cls, scope: AgentAppSessionScope):
        return cls._scope_stmt(scope).where(AgentRuntimeSession.status == AgentRuntimeSessionStatus.ACTIVE)


__all__ = ["AgentAppRuntimeSessionStore", "AgentAppSessionScope", "StoredAgentAppSession"]
