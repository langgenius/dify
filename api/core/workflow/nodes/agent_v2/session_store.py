"""Workflow Agent participant persistence keyed by node execution."""

from __future__ import annotations

import json
from dataclasses import dataclass

from agenton.compositor import CompositorSessionSnapshot
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from models.agent import (
    AgentConfigVersionKind,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.workflow import WorkflowNodeExecutionModel
from services.agent.workspace_service import (
    AgentWorkspaceNotFoundError,
    AgentWorkspaceService,
    WorkspaceOwnerScope,
)


@dataclass(frozen=True, slots=True)
class WorkflowAgentSessionScope:
    tenant_id: str
    app_id: str
    workflow_id: str
    workflow_run_id: str | None
    node_id: str
    node_execution_id: str
    workflow_agent_binding_id: str
    agent_id: str
    agent_config_snapshot_id: str

    @property
    def workspace_owner(self) -> WorkspaceOwnerScope:
        return WorkspaceOwnerScope(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
            owner_id=self.workflow_run_id or self.node_execution_id,
            owner_scope_key=f"{self.node_id}:{self.workflow_agent_binding_id}",
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
    """Load or create the participant named by a node execution caller row."""

    def load_or_create_node_execution_session(
        self, scope: WorkflowAgentSessionScope, *, home_snapshot_id: str
    ) -> StoredWorkflowAgentSession:
        with session_factory.create_session() as session:
            execution = self._load_execution(session=session, scope=scope)
            process_data = execution.process_data_dict
            if process_data is None:
                process_data = {}
            if not isinstance(process_data, dict):
                raise AgentWorkspaceNotFoundError("Workflow node execution caller identity is invalid")
            stored_workflow_binding_id = process_data.get("workflow_agent_binding_id")
            if stored_workflow_binding_id is not None and stored_workflow_binding_id != scope.workflow_agent_binding_id:
                raise AgentWorkspaceNotFoundError("Workflow node execution caller identity does not match")

            binding_id = execution.agent_workspace_binding_id
            if binding_id is None:
                binding = AgentWorkspaceService.create_binding(
                    session=session,
                    scope=scope.workspace_owner,
                    agent_id=scope.agent_id,
                    base_home_snapshot_id=home_snapshot_id,
                    agent_config_version_id=scope.agent_config_snapshot_id,
                    agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
                )
                execution.agent_workspace_binding_id = binding.id
                execution.process_data = json.dumps(
                    {
                        **process_data,
                        "workflow_agent_binding_id": scope.workflow_agent_binding_id,
                    },
                    ensure_ascii=False,
                )
                session.commit()
            else:
                if stored_workflow_binding_id is None:
                    raise AgentWorkspaceNotFoundError("Workflow node execution caller identity is missing")
                binding = AgentWorkspaceService.get_active_binding(
                    session=session,
                    tenant_id=scope.tenant_id,
                    binding_id=binding_id,
                    expected_owner_scope=scope.workspace_owner,
                )
                if binding is None or binding.agent_id != scope.agent_id:
                    raise AgentWorkspaceNotFoundError("Workflow node participant Binding is unavailable")
                AgentWorkspaceService.validate_binding_generation(
                    binding,
                    base_home_snapshot_id=home_snapshot_id,
                    agent_config_version_id=scope.agent_config_snapshot_id,
                    agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
                )
            return self._stored(scope, binding)

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

    def retire_workflow_run(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> list[str]:
        """Retire active Workspaces, commit, and return active or already-retired IDs for collection."""

        retired: list[str] = []
        with session_factory.create_session() as session:
            workspaces = session.scalars(
                select(AgentWorkspace).where(
                    AgentWorkspace.tenant_id == tenant_id,
                    AgentWorkspace.app_id == app_id,
                    AgentWorkspace.owner_type == AgentWorkspaceOwnerType.WORKFLOW_RUN,
                    AgentWorkspace.owner_id == workflow_run_id,
                    AgentWorkspace.status.in_((AgentWorkingResourceStatus.ACTIVE, AgentWorkingResourceStatus.RETIRED)),
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
        return retired

    @staticmethod
    def _load_execution(*, session: Session, scope: WorkflowAgentSessionScope) -> WorkflowNodeExecutionModel:
        execution = session.scalar(
            select(WorkflowNodeExecutionModel)
            .where(
                WorkflowNodeExecutionModel.id == scope.node_execution_id,
                WorkflowNodeExecutionModel.tenant_id == scope.tenant_id,
                WorkflowNodeExecutionModel.app_id == scope.app_id,
                WorkflowNodeExecutionModel.workflow_id == scope.workflow_id,
                WorkflowNodeExecutionModel.node_id == scope.node_id,
                WorkflowNodeExecutionModel.workflow_run_id == scope.workflow_run_id,
            )
        )
        if execution is None:
            raise AgentWorkspaceNotFoundError("Workflow node execution caller is unavailable")
        return execution

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
