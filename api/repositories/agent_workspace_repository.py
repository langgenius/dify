"""Agent Workspace persistence within a caller-owned session and transaction."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.agent.workspace import WorkspaceOwnerScope
from libs.datetime_utils import naive_utc_now
from models.agent import AgentWorkingResourceStatus, AgentWorkspace, AgentWorkspaceBinding, AgentWorkspaceOwnerType


class AgentWorkspaceRepository:
    """Borrow a session without committing, rolling back, or closing it."""

    def __init__(self, *, session: Session) -> None:
        self._session: Session = session

    def get_active_binding(
        self,
        *,
        tenant_id: str,
        binding_id: str,
        expected_owner_scope: WorkspaceOwnerScope,
    ) -> AgentWorkspaceBinding | None:
        """Return the active binding in the exact owner scope, or None if unavailable."""
        return self._session.scalar(
            select(AgentWorkspaceBinding)
            .join(
                AgentWorkspace,
                (AgentWorkspace.tenant_id == AgentWorkspaceBinding.tenant_id)
                & (AgentWorkspace.id == AgentWorkspaceBinding.workspace_id),
            )
            .where(
                AgentWorkspaceBinding.id == binding_id,
                AgentWorkspaceBinding.tenant_id == tenant_id,
                AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                AgentWorkspace.tenant_id == expected_owner_scope.tenant_id,
                AgentWorkspace.app_id == expected_owner_scope.app_id,
                AgentWorkspace.owner_type == expected_owner_scope.owner_type,
                AgentWorkspace.owner_id == expected_owner_scope.owner_id,
                AgentWorkspace.owner_scope_key == expected_owner_scope.owner_scope_key,
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
            )
        )

    def retire_workspace(self, *, tenant_id: str, workspace_id: str) -> str | None:
        """Retire a workspace and its active bindings; return None if it is not active or not found."""
        workspace = self._session.scalar(
            select(AgentWorkspace)
            .where(
                AgentWorkspace.id == workspace_id,
                AgentWorkspace.tenant_id == tenant_id,
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
            )
            .with_for_update()
        )
        if workspace is None:
            return None
        now = naive_utc_now()
        workspace.status = AgentWorkingResourceStatus.RETIRED
        workspace.active_guard = None
        workspace.retired_at = now
        bindings = self._session.scalars(
            select(AgentWorkspaceBinding).where(
                AgentWorkspaceBinding.tenant_id == tenant_id,
                AgentWorkspaceBinding.workspace_id == workspace.id,
                AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
            )
        ).all()
        for binding in bindings:
            binding.status = AgentWorkingResourceStatus.RETIRED
            binding.retired_at = now
        return workspace.id

    def retire_all_for_conversation(self, *, tenant_id: str, app_id: str, conversation_id: str) -> list[str]:
        """Retire all active workspaces owned by the conversation, including Chatflow nodes."""
        workspaces = self._session.scalars(
            select(AgentWorkspace).where(
                AgentWorkspace.tenant_id == tenant_id,
                AgentWorkspace.app_id == app_id,
                AgentWorkspace.owner_type == AgentWorkspaceOwnerType.CONVERSATION,
                AgentWorkspace.owner_id == conversation_id,
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
            )
        ).all()
        retired: list[str] = []
        for workspace in workspaces:
            workspace_id = self.retire_workspace(tenant_id=tenant_id, workspace_id=workspace.id)
            if workspace_id is not None:
                retired.append(workspace_id)
        return retired
