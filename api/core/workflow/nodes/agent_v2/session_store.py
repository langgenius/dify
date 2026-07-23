"""Workflow Agent node Workspace Binding persistence."""

from __future__ import annotations

from dataclasses import dataclass

from agenton.compositor import CompositorSessionSnapshot
from sqlalchemy import select

from core.db.session_factory import session_factory
from models.agent import (
    AgentConfigVersionKind,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from services.agent.workspace_service import AgentWorkspaceService, WorkspaceOwnerScope


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

    @property
    def workspace_owner(self) -> WorkspaceOwnerScope:
        return WorkspaceOwnerScope(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
            owner_id=self.workflow_run_id or self.node_execution_id,
            owner_scope_key=f"{self.node_id}:{self.binding_id}",
        )


@dataclass(frozen=True, slots=True)
class StoredWorkflowAgentSession:
    scope: WorkflowAgentSessionScope
    binding_id: str
    workspace_id: str
    backend_binding_ref: str
    session_snapshot: CompositorSessionSnapshot | None
    pending_form_id: str | None = None
    pending_tool_call_id: str | None = None


class WorkflowAgentWorkspaceStore:
    def resolve_or_create(
        self, scope: WorkflowAgentSessionScope, *, home_snapshot_id: str
    ) -> StoredWorkflowAgentSession:
        binding = AgentWorkspaceService.create_or_resolve_binding(
            scope=scope.workspace_owner,
            agent_id=scope.agent_id,
            base_home_snapshot_id=home_snapshot_id,
            agent_config_version_id=scope.agent_config_snapshot_id,
            agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        )
        return self._stored(scope, binding)

    def load_active_snapshot(self, scope: WorkflowAgentSessionScope) -> CompositorSessionSnapshot | None:
        stored = self.load_active_session(scope)
        return stored.session_snapshot if stored is not None else None

    def load_active_session(self, scope: WorkflowAgentSessionScope) -> StoredWorkflowAgentSession | None:
        with session_factory.create_session() as session:
            binding = AgentWorkspaceService.resolve_active_binding(
                session=session,
                scope=scope.workspace_owner,
                agent_id=scope.agent_id,
            )
            return self._stored(scope, binding) if binding is not None else None

    def save_active_snapshot(
        self,
        *,
        scope: WorkflowAgentSessionScope,
        binding_id: str,
        snapshot: CompositorSessionSnapshot | None,
        pending_form_id: str | None = None,
        pending_tool_call_id: str | None = None,
    ) -> None:
        if snapshot is None:
            return
        AgentWorkspaceService.save_binding_session_snapshot(
            tenant_id=scope.tenant_id,
            binding_id=binding_id,
            session_snapshot=snapshot.model_dump_json(),
            pending_form_id=pending_form_id,
            pending_tool_call_id=pending_tool_call_id,
        )

    def retire_workflow_run(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> None:
        """Retire, commit, then collect all active or previously retired Workspaces for one run."""

        retired: list[str] = []
        with session_factory.create_session() as session:
            workspaces = session.scalars(
                select(AgentWorkspace).where(
                    AgentWorkspace.tenant_id == tenant_id,
                    AgentWorkspace.app_id == app_id,
                    AgentWorkspace.owner_type == AgentWorkspaceOwnerType.WORKFLOW_RUN,
                    AgentWorkspace.owner_id == workflow_run_id,
                    AgentWorkspace.status.in_(
                        (AgentWorkingResourceStatus.ACTIVE, AgentWorkingResourceStatus.RETIRED)
                    ),
                )
            ).all()
            for workspace in workspaces:
                if workspace.status == AgentWorkingResourceStatus.RETIRED:
                    retired.append(workspace.id)
                    continue
                workspace_id = AgentWorkspaceService.retire_workspace(
                    session=session,
                    tenant_id=tenant_id,
                    workspace_id=workspace.id,
                )
                if workspace_id is not None:
                    retired.append(workspace_id)
            session.commit()
        for workspace_id in retired:
            AgentWorkspaceService.collect_retired_workspace(tenant_id=tenant_id, workspace_id=workspace_id)

    @staticmethod
    def _stored(scope: WorkflowAgentSessionScope, binding: AgentWorkspaceBinding) -> StoredWorkflowAgentSession:
        snapshot = (
            CompositorSessionSnapshot.model_validate_json(binding.session_snapshot)
            if binding.session_snapshot
            else None
        )
        return StoredWorkflowAgentSession(
            scope=scope,
            binding_id=binding.id,
            workspace_id=binding.workspace_id,
            backend_binding_ref=binding.backend_binding_ref,
            session_snapshot=snapshot,
            pending_form_id=binding.pending_form_id,
            pending_tool_call_id=binding.pending_tool_call_id,
        )


__all__ = ["StoredWorkflowAgentSession", "WorkflowAgentSessionScope", "WorkflowAgentWorkspaceStore"]
