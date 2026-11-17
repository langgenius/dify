"""Agent Workspace persistence within a caller-owned session and transaction."""

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.orm import Session

from core.agent.workspace import AgentWorkspaceBindingGenerationMismatchError, WorkspaceOwnerScope
from libs.datetime_utils import naive_utc_now
from models.agent import (
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.workflow import WorkflowNodeExecutionModel


def validate_binding_generation(
    binding: AgentWorkspaceBinding,
    *,
    base_home_snapshot_id: str | None,
    agent_config_version_id: str,
    agent_config_version_kind: AgentConfigVersionKind,
) -> None:
    """Require an owner-checked binding to match the expected Agent config and Home generation."""
    if (
        binding.base_home_snapshot_id != base_home_snapshot_id
        or binding.agent_config_version_id != agent_config_version_id
        or binding.agent_config_version_kind != agent_config_version_kind
    ):
        raise AgentWorkspaceBindingGenerationMismatchError(
            "ACTIVE Binding belongs to a different Agent config/Home generation"
        )


def workflow_tool_workspace_owned_by_app(tenant_id: str, app_id: str) -> ColumnElement[bool]:
    """Follow the persisted caller and Binding, independently of optional run-log storage."""
    return (
        select(WorkflowNodeExecutionModel.id)
        .join(
            AgentWorkspaceBinding,
            AgentWorkspaceBinding.id == WorkflowNodeExecutionModel.agent_workspace_binding_id,
        )
        .where(
            WorkflowNodeExecutionModel.workflow_tool_owned_by_app(tenant_id=tenant_id, app_id=app_id),
            WorkflowNodeExecutionModel.workflow_run_id == AgentWorkspace.owner_id,
            WorkflowNodeExecutionModel.app_id == AgentWorkspace.app_id,
            AgentWorkspace.owner_type == AgentWorkspaceOwnerType.WORKFLOW_RUN,
            AgentWorkspaceBinding.tenant_id == tenant_id,
            AgentWorkspaceBinding.app_id == AgentWorkspace.app_id,
            AgentWorkspaceBinding.workspace_id == AgentWorkspace.id,
        )
        .exists()
    )


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
        for_update: bool = False,
    ) -> AgentWorkspaceBinding | None:
        """Return the active owner-scoped binding, optionally locking it and its workspace for mutation."""
        stmt = (
            select(AgentWorkspaceBinding)
            .join(
                AgentWorkspace,
                (AgentWorkspace.tenant_id == AgentWorkspaceBinding.tenant_id)
                & (AgentWorkspace.id == AgentWorkspaceBinding.workspace_id),
            )
            .where(
                AgentWorkspaceBinding.id == binding_id,
                AgentWorkspaceBinding.tenant_id == tenant_id,
                AgentWorkspaceBinding.app_id == expected_owner_scope.app_id,
                AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                AgentWorkspace.tenant_id == expected_owner_scope.tenant_id,
                AgentWorkspace.app_id == expected_owner_scope.app_id,
                AgentWorkspace.owner_type == expected_owner_scope.owner_type,
                AgentWorkspace.owner_id == expected_owner_scope.owner_id,
                AgentWorkspace.owner_scope_key == expected_owner_scope.owner_scope_key,
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
            )
        )
        if for_update:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        return self._session.scalar(stmt)

    def retire_binding(self, *, tenant_id: str, binding_id: str) -> str | None:
        """Retire the active tenant binding and its workspace if no active siblings remain."""
        binding = self._session.scalar(
            select(AgentWorkspaceBinding)
            .where(
                AgentWorkspaceBinding.id == binding_id,
                AgentWorkspaceBinding.tenant_id == tenant_id,
                AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
            )
            .with_for_update()
        )
        if binding is None:
            return None
        workspace = self._session.scalar(
            select(AgentWorkspace)
            .where(
                AgentWorkspace.id == binding.workspace_id,
                AgentWorkspace.tenant_id == tenant_id,
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
            )
            .with_for_update()
        )
        now = naive_utc_now()
        binding.status = AgentWorkingResourceStatus.RETIRED
        binding.retired_at = now
        if workspace is not None:
            other_binding = self._session.scalar(
                select(AgentWorkspaceBinding.id).where(
                    AgentWorkspaceBinding.tenant_id == tenant_id,
                    AgentWorkspaceBinding.workspace_id == workspace.id,
                    AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                    AgentWorkspaceBinding.id != binding.id,
                )
            )
            if other_binding is None:
                workspace.status = AgentWorkingResourceStatus.RETIRED
                workspace.active_guard = None
                workspace.retired_at = now
        return binding.id

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

    def retire_all_for_app(self, *, tenant_id: str, app_id: str) -> list[str]:
        """Retire active app Workspaces, including source-app participants in its Workflow runs."""

        workspaces = self._session.scalars(
            select(AgentWorkspace).where(
                AgentWorkspace.tenant_id == tenant_id,
                or_(AgentWorkspace.app_id == app_id, workflow_tool_workspace_owned_by_app(tenant_id, app_id)),
                AgentWorkspace.status == AgentWorkingResourceStatus.ACTIVE,
            )
        ).all()
        retired: list[str] = []
        for workspace in workspaces:
            workspace_id = self.retire_workspace(tenant_id=tenant_id, workspace_id=workspace.id)
            if workspace_id is not None:
                retired.append(workspace_id)
        return retired

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

    def retire_home_snapshots_for_agent(self, *, tenant_id: str, agent_id: str) -> list[str]:
        """Retire active tenant snapshots and return all matched ids for cleanup retries."""
        rows = self._session.scalars(
            select(AgentHomeSnapshot).where(
                AgentHomeSnapshot.tenant_id == tenant_id,
                AgentHomeSnapshot.agent_id == agent_id,
            )
        ).all()
        now = naive_utc_now()
        for row in rows:
            if row.status == AgentWorkingResourceStatus.ACTIVE:
                row.status = AgentWorkingResourceStatus.RETIRED
                row.retired_at = now
        return [row.id for row in rows]
