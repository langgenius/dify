from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from models.agent import (
    Agent,
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.enums import AppStatus
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.agent.workspace_service import AgentWorkspaceService


def test_retire_unowned_commits_resource_retirement(monkeypatch) -> None:
    context = MagicMock()
    session = context.__enter__.return_value
    session.scalars.return_value.all.return_value = [SimpleNamespace(id="binding-1")]
    monkeypatch.setattr(
        "services.agent.retirement_service.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(
        WorkflowAgentRetirementService,
        "archive_unowned",
        MagicMock(return_value=["agent-1"]),
    )
    monkeypatch.setattr(
        AgentWorkspaceService,
        "retire_binding",
        MagicMock(return_value="binding-1"),
    )
    monkeypatch.setattr(
        AgentHomeSnapshotService,
        "retire_all_for_agent",
        MagicMock(return_value=["home-1"]),
    )

    result = WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=["agent-1"],
        account_id="account-1",
    )

    assert result == (["binding-1"], ["home-1"])
    session.commit.assert_called_once_with()


def _workflow_only_agent() -> Agent:
    return Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Inline Agent",
        description="",
        role="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(Agent, App, Workflow, WorkflowAgentNodeBinding)],
    indirect=True,
)
def test_retire_unowned_keeps_effectively_owned_agent_active(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    agent = _workflow_only_agent()
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Workflow",
        mode=AppMode.WORKFLOW,
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=True,
    )
    workflow = Workflow.new(
        tenant_id="tenant-1",
        app_id=app.id,
        type=WorkflowType.WORKFLOW.value,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        features="{}",
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id=app.id,
        workflow_id=workflow.id,
        workflow_version=workflow.version,
        node_id="agent-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id=agent.id,
        current_snapshot_id="config-1",
        node_job_config={},
    )
    sqlite_session.add_all([agent, app, workflow, binding])
    sqlite_session.commit()
    monkeypatch.setattr(
        "services.agent.retirement_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )

    result = WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[agent.id],
        account_id="account-1",
    )

    assert result == ([], [])
    assert sqlite_session.get(Agent, agent.id).status is AgentStatus.ACTIVE


@pytest.mark.parametrize(
    "sqlite_session",
    [(Agent, App, Workflow, WorkflowAgentNodeBinding, AgentHomeSnapshot, AgentWorkspace, AgentWorkspaceBinding)],
    indirect=True,
)
def test_retire_unowned_archives_orphan_and_retires_resources(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    agent = _workflow_only_agent()
    home = AgentHomeSnapshot(
        id="home-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        snapshot_ref="home-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
    )
    workspace = AgentWorkspace(
        id="workspace-1",
        tenant_id="tenant-1",
        app_id="app-1",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation-1",
        owner_scope_key="root",
        backend_workspace_ref="workspace-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )
    binding = AgentWorkspaceBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id=workspace.id,
        agent_id=agent.id,
        base_home_snapshot_id=home.id,
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="binding-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
    )
    sqlite_session.add_all([agent, home, workspace, binding])
    sqlite_session.commit()
    monkeypatch.setattr(
        "services.agent.retirement_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )

    result = WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[agent.id],
        account_id="account-1",
    )

    assert result == ([binding.id], [home.id])
    assert sqlite_session.get(Agent, agent.id).status is AgentStatus.ARCHIVED
    assert sqlite_session.get(AgentWorkspaceBinding, binding.id).status is AgentWorkingResourceStatus.RETIRED
    assert sqlite_session.get(AgentWorkspace, workspace.id).status is AgentWorkingResourceStatus.RETIRED
    assert sqlite_session.get(AgentHomeSnapshot, home.id).status is AgentWorkingResourceStatus.RETIRED
