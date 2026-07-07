from __future__ import annotations

from dataclasses import dataclass, field

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol import RuntimeLayerSpec
from pydantic import TypeAdapter
from sqlalchemy import select

from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from models.agent import (
    AgentRuntimeSessionOwnerType,
    WorkflowAgentRuntimeSession,
    WorkflowAgentRuntimeSessionStatus,
)

_SPECS_ADAPTER: TypeAdapter[list[RuntimeLayerSpec]] = TypeAdapter(list[RuntimeLayerSpec])


def _serialize_specs(specs: list[RuntimeLayerSpec]) -> str:
    return _SPECS_ADAPTER.dump_json(specs).decode()


def _deserialize_specs(value: str | None) -> list[RuntimeLayerSpec]:
    if not value:
        return []
    return _SPECS_ADAPTER.validate_json(value)


@dataclass(frozen=True, slots=True)
class WorkflowAgentSessionScope:
    tenant_id: str
    app_id: str
    workflow_id: str
    workflow_run_id: str | None
    node_id: str
    node_execution_id: str
    binding_id: str
    agent_id: str
    agent_config_snapshot_id: str


@dataclass(frozen=True, slots=True)
class StoredWorkflowAgentSession:
    scope: WorkflowAgentSessionScope
    session_snapshot: CompositorSessionSnapshot
    backend_run_id: str | None
    runtime_layer_specs: list[RuntimeLayerSpec] = field(default_factory=list)
    # ENG-637: set while the session is paused on a dify.ask_human deferred call.
    pending_form_id: str | None = None
    pending_tool_call_id: str | None = None


class WorkflowAgentRuntimeSessionStore:
    """Stores Agent backend session snapshots for workflow Agent node re-entry."""

    def load_active_snapshot(self, scope: WorkflowAgentSessionScope) -> CompositorSessionSnapshot | None:
        stored = self.load_active_session(scope)
        return stored.session_snapshot if stored is not None else None

    def load_active_session(self, scope: WorkflowAgentSessionScope) -> StoredWorkflowAgentSession | None:
        """Load the active session row including any pending ask_human correlation."""
        if scope.workflow_run_id is None:
            return None

        with session_factory.create_session() as session:
            row = session.scalar(
                select(WorkflowAgentRuntimeSession).where(
                    WorkflowAgentRuntimeSession.tenant_id == scope.tenant_id,
                    WorkflowAgentRuntimeSession.workflow_run_id == scope.workflow_run_id,
                    WorkflowAgentRuntimeSession.node_id == scope.node_id,
                    WorkflowAgentRuntimeSession.binding_id == scope.binding_id,
                    WorkflowAgentRuntimeSession.agent_id == scope.agent_id,
                    WorkflowAgentRuntimeSession.status == WorkflowAgentRuntimeSessionStatus.ACTIVE,
                )
            )
            if row is None:
                return None
            return StoredWorkflowAgentSession(
                scope=scope,
                session_snapshot=CompositorSessionSnapshot.model_validate_json(row.session_snapshot),
                backend_run_id=row.backend_run_id,
                runtime_layer_specs=_deserialize_specs(row.composition_layer_specs),
                pending_form_id=row.pending_form_id,
                pending_tool_call_id=row.pending_tool_call_id,
            )

    def list_active_sessions(self, *, workflow_run_id: str) -> list[StoredWorkflowAgentSession]:
        with session_factory.create_session() as session:
            rows = session.scalars(
                select(WorkflowAgentRuntimeSession).where(
                    WorkflowAgentRuntimeSession.workflow_run_id == workflow_run_id,
                    WorkflowAgentRuntimeSession.status == WorkflowAgentRuntimeSessionStatus.ACTIVE,
                )
            ).all()
            return [
                StoredWorkflowAgentSession(
                    scope=WorkflowAgentSessionScope(
                        tenant_id=row.tenant_id,
                        app_id=row.app_id,
                        # These columns are nullable on the unified runtime-session
                        # table (workflow_run ⊕ conversation owner), but are always
                        # populated for a workflow-owned row; coerce for the typed scope.
                        workflow_id=row.workflow_id or "",
                        workflow_run_id=row.workflow_run_id,
                        node_id=row.node_id or "",
                        node_execution_id=row.node_execution_id or "",
                        binding_id=row.binding_id or "",
                        agent_id=row.agent_id,
                        agent_config_snapshot_id=row.agent_config_snapshot_id or "",
                    ),
                    session_snapshot=CompositorSessionSnapshot.model_validate_json(row.session_snapshot),
                    backend_run_id=row.backend_run_id,
                    runtime_layer_specs=_deserialize_specs(row.composition_layer_specs),
                )
                for row in rows
            ]

    def save_active_snapshot(
        self,
        *,
        scope: WorkflowAgentSessionScope,
        backend_run_id: str,
        snapshot: CompositorSessionSnapshot | None,
        runtime_layer_specs: list[RuntimeLayerSpec],
        pending_form_id: str | None = None,
        pending_tool_call_id: str | None = None,
    ) -> None:
        if scope.workflow_run_id is None or snapshot is None:
            return

        snapshot_json = snapshot.model_dump_json()
        specs_json = _serialize_specs(runtime_layer_specs)
        with session_factory.create_session() as session:
            row = session.scalar(
                select(WorkflowAgentRuntimeSession).where(
                    WorkflowAgentRuntimeSession.tenant_id == scope.tenant_id,
                    WorkflowAgentRuntimeSession.workflow_run_id == scope.workflow_run_id,
                    WorkflowAgentRuntimeSession.node_id == scope.node_id,
                    WorkflowAgentRuntimeSession.binding_id == scope.binding_id,
                    WorkflowAgentRuntimeSession.agent_id == scope.agent_id,
                )
            )
            if row is None:
                row = WorkflowAgentRuntimeSession(
                    tenant_id=scope.tenant_id,
                    app_id=scope.app_id,
                    owner_type=AgentRuntimeSessionOwnerType.WORKFLOW_RUN,
                    workflow_id=scope.workflow_id,
                    workflow_run_id=scope.workflow_run_id,
                    node_id=scope.node_id,
                    node_execution_id=scope.node_execution_id,
                    binding_id=scope.binding_id,
                    agent_id=scope.agent_id,
                    agent_config_snapshot_id=scope.agent_config_snapshot_id,
                    backend_run_id=backend_run_id,
                    session_snapshot=snapshot_json,
                    composition_layer_specs=specs_json,
                    status=WorkflowAgentRuntimeSessionStatus.ACTIVE,
                    pending_form_id=pending_form_id,
                    pending_tool_call_id=pending_tool_call_id,
                )
                session.add(row)
            else:
                row.node_execution_id = scope.node_execution_id
                row.agent_config_snapshot_id = scope.agent_config_snapshot_id
                row.backend_run_id = backend_run_id
                row.session_snapshot = snapshot_json
                row.composition_layer_specs = specs_json
                row.status = WorkflowAgentRuntimeSessionStatus.ACTIVE
                row.cleaned_at = None
                # Set (or clear, when omitted) the ask_human pause correlation.
                row.pending_form_id = pending_form_id
                row.pending_tool_call_id = pending_tool_call_id
            session.commit()

    def mark_cleaned(self, *, scope: WorkflowAgentSessionScope, backend_run_id: str | None = None) -> None:
        if scope.workflow_run_id is None:
            return

        with session_factory.create_session() as session:
            row = session.scalar(
                select(WorkflowAgentRuntimeSession).where(
                    WorkflowAgentRuntimeSession.tenant_id == scope.tenant_id,
                    WorkflowAgentRuntimeSession.workflow_run_id == scope.workflow_run_id,
                    WorkflowAgentRuntimeSession.node_id == scope.node_id,
                    WorkflowAgentRuntimeSession.binding_id == scope.binding_id,
                    WorkflowAgentRuntimeSession.agent_id == scope.agent_id,
                    WorkflowAgentRuntimeSession.status == WorkflowAgentRuntimeSessionStatus.ACTIVE,
                )
            )
            if row is None:
                return
            if backend_run_id is not None:
                row.backend_run_id = backend_run_id
            row.status = WorkflowAgentRuntimeSessionStatus.CLEANED
            row.cleaned_at = naive_utc_now()
            session.commit()


__all__ = [
    "StoredWorkflowAgentSession",
    "WorkflowAgentRuntimeSessionStore",
    "WorkflowAgentSessionScope",
]
