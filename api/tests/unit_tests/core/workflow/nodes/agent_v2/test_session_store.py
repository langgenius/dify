from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from agenton.compositor import CompositorSessionSnapshot
from sqlalchemy.orm import Session

from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope, WorkflowAgentWorkspaceStore
from models.agent import (
    AgentConfigVersionKind,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from services.agent.workspace_service import AgentWorkspaceService


def _scope() -> WorkflowAgentSessionScope:
    return WorkflowAgentSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="execution-1",
        binding_id="workflow-binding-1",
        agent_id="agent-1",
        agent_config_snapshot_id="config-1",
    )


def _binding() -> SimpleNamespace:
    return SimpleNamespace(
        id="binding-1",
        workspace_id="workspace-1",
        backend_binding_ref="backend-binding-1",
        session_snapshot=None,
        pending_form_id=None,
        pending_tool_call_id=None,
    )


def _workspace_row(
    *,
    workspace_id: str = "workspace-1",
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    owner_scope_key: str = "node-1:workflow-binding-1",
    status: AgentWorkingResourceStatus = AgentWorkingResourceStatus.ACTIVE,
) -> AgentWorkspace:
    return AgentWorkspace(
        id=workspace_id,
        tenant_id=tenant_id,
        app_id=app_id,
        owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN,
        owner_id="run-1",
        owner_scope_key=owner_scope_key,
        backend_workspace_ref=f"{workspace_id}-ref",
        status=status,
        active_guard=1 if status is AgentWorkingResourceStatus.ACTIVE else None,
    )


def _binding_row(
    *,
    binding_id: str = "binding-1",
    workspace_id: str = "workspace-1",
    status: AgentWorkingResourceStatus = AgentWorkingResourceStatus.ACTIVE,
) -> AgentWorkspaceBinding:
    return AgentWorkspaceBinding(
        id=binding_id,
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id=workspace_id,
        agent_id="agent-1",
        base_home_snapshot_id="home-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref=f"{binding_id}-ref",
        status=status,
        active_guard=1 if status is AgentWorkingResourceStatus.ACTIVE else None,
    )


def test_scope_uses_node_and_workflow_binding_as_workspace_subscope() -> None:
    owner = _scope().workspace_owner
    assert owner.owner_type is AgentWorkspaceOwnerType.WORKFLOW_RUN
    assert owner.owner_id == "run-1"
    assert owner.owner_scope_key == "node-1:workflow-binding-1"


def test_resolve_or_create_returns_binding_identity(monkeypatch) -> None:
    create = MagicMock(return_value=_binding())
    monkeypatch.setattr(AgentWorkspaceService, "create_or_resolve_binding", create)

    stored = WorkflowAgentWorkspaceStore().resolve_or_create(_scope(), home_snapshot_id="home-1")

    assert stored.binding_id == "binding-1"
    assert stored.workspace_id == "workspace-1"
    assert stored.backend_binding_ref == "backend-binding-1"


def test_save_snapshot_targets_binding(monkeypatch) -> None:
    save = MagicMock()
    monkeypatch.setattr(AgentWorkspaceService, "save_binding_session_snapshot", save)
    snapshot = CompositorSessionSnapshot(layers=[])

    WorkflowAgentWorkspaceStore().save_active_snapshot(scope=_scope(), binding_id="binding-1", snapshot=snapshot)

    assert save.call_args.kwargs["binding_id"] == "binding-1"


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_retire_workflow_run_only_retires_matching_tenant_and_app(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    matching = _workspace_row()
    other_tenant = _workspace_row(workspace_id="workspace-other-tenant", tenant_id="tenant-2")
    other_app = _workspace_row(
        workspace_id="workspace-other-app",
        app_id="app-2",
        owner_scope_key="node-2:workflow-binding-2",
    )
    sqlite_session.add_all([matching, other_tenant, other_app])
    sqlite_session.commit()
    collect = MagicMock()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )
    monkeypatch.setattr(AgentWorkspaceService, "collect_retired_workspace", collect)

    WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
    )

    assert matching.status is AgentWorkingResourceStatus.RETIRED
    assert other_tenant.status is AgentWorkingResourceStatus.ACTIVE
    assert other_app.status is AgentWorkingResourceStatus.ACTIVE
    collect.assert_called_once_with(tenant_id="tenant-1", workspace_id=matching.id)


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_retire_workflow_run_transitions_active_workspace_before_collect(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    workspace = _workspace_row()
    binding = _binding_row()
    sqlite_session.add_all([workspace, binding])
    sqlite_session.commit()
    observed_statuses: list[AgentWorkingResourceStatus] = []

    def collect(*, tenant_id: str, workspace_id: str) -> None:
        assert tenant_id == "tenant-1"
        stored = sqlite_session.get(AgentWorkspace, workspace_id)
        assert stored is not None
        observed_statuses.append(stored.status)

    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )
    monkeypatch.setattr(AgentWorkspaceService, "collect_retired_workspace", collect)

    WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
    )

    assert workspace.status is AgentWorkingResourceStatus.RETIRED
    assert binding.status is AgentWorkingResourceStatus.RETIRED
    assert observed_statuses == [AgentWorkingResourceStatus.RETIRED]


def test_retire_workflow_run_retry_collects_existing_retired_workspace(monkeypatch) -> None:
    workspace = _workspace_row(status=AgentWorkingResourceStatus.RETIRED)
    context = MagicMock()
    session = context.__enter__.return_value
    session.scalars.return_value.all.return_value = [workspace]
    retire = MagicMock()
    collect = MagicMock()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(AgentWorkspaceService, "retire_workspace", retire)
    monkeypatch.setattr(AgentWorkspaceService, "collect_retired_workspace", collect)

    WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
    )

    retire.assert_not_called()
    session.commit.assert_called_once_with()
    collect.assert_called_once_with(tenant_id="tenant-1", workspace_id=workspace.id)


def test_retire_workflow_run_does_not_collect_when_commit_fails(monkeypatch) -> None:
    workspace = _workspace_row(status=AgentWorkingResourceStatus.RETIRED)
    context = MagicMock()
    session = context.__enter__.return_value
    session.scalars.return_value.all.return_value = [workspace]
    session.commit.side_effect = RuntimeError("commit failed")
    collect = MagicMock()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(AgentWorkspaceService, "collect_retired_workspace", collect)

    with pytest.raises(RuntimeError, match="commit failed"):
        WorkflowAgentWorkspaceStore().retire_workflow_run(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_run_id="run-1",
        )

    collect.assert_not_called()
