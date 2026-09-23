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


def test_retire_unowned_failure_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    context = MagicMock()
    error = RuntimeError("retirement failed")
    monkeypatch.setattr(
        "services.agent.retirement_service.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(
        WorkflowAgentRetirementService,
        "archive_unowned",
        MagicMock(side_effect=error),
    )

    with pytest.raises(RuntimeError) as exc_info:
        WorkflowAgentRetirementService.retire_unowned(
            tenant_id="tenant-1",
            agent_ids=["agent-1"],
            account_id="account-1",
        )

    assert exc_info.value is error


def _workflow_only_agent(*, backing_app_id: str | None = None) -> Agent:
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
        backing_app_id=backing_app_id,
    )


@pytest.mark.parametrize(
    ("workflow_version", "pointer_to_owner", "mismatched_key", "expected_status"),
    [
        pytest.param(Workflow.VERSION_DRAFT, False, None, AgentStatus.ACTIVE, id="draft-owner"),
        pytest.param("current-version", True, None, AgentStatus.ACTIVE, id="current-published-owner"),
        pytest.param("historical-version", False, None, AgentStatus.ACTIVE, id="historical-published-owner"),
        pytest.param("v1", True, "tenant_id", AgentStatus.ARCHIVED, id="tenant-mismatch"),
        pytest.param("v1", True, "app_id", AgentStatus.ARCHIVED, id="app-mismatch"),
        pytest.param("v1", True, "workflow_id", AgentStatus.ARCHIVED, id="workflow-mismatch"),
        pytest.param("v1", True, "workflow_version", AgentStatus.ARCHIVED, id="version-mismatch"),
    ],
)
def test_retire_unowned_requires_an_exact_persisted_workflow_owner_key(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    workflow_version: str,
    pointer_to_owner: bool,
    mismatched_key: str | None,
    expected_status: AgentStatus,
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
        tenant_id="workflow-tenant" if mismatched_key == "tenant_id" else "tenant-1",
        app_id=app.id,
        type=WorkflowType.WORKFLOW.value,
        version=workflow_version,
        graph="{}",
        features="{}",
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    app.workflow_id = workflow.id if pointer_to_owner else "another-current-workflow"
    binding_key = {
        "tenant_id": "tenant-1",
        "app_id": workflow.app_id,
        "workflow_id": workflow.id,
        "workflow_version": workflow.version,
    }
    mismatched_values = {
        "app_id": "app-2",
        "workflow_id": "workflow-2",
        "workflow_version": "other-version",
    }
    if mismatched_key is not None and mismatched_key != "tenant_id":
        binding_key[mismatched_key] = mismatched_values[mismatched_key]
    binding = WorkflowAgentNodeBinding(
        **binding_key,
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
    celery_delay = MagicMock()
    monkeypatch.setattr("tasks.collect_agent_resources_task.collect_agent_resources.delay", celery_delay)
    WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[agent.id],
        account_id="account-1",
    )

    stored_agent = sqlite_session.get(Agent, agent.id)
    assert stored_agent is not None
    assert stored_agent.status is expected_status
    if expected_status is AgentStatus.ACTIVE:
        celery_delay.assert_not_called()
    else:
        celery_delay.assert_called_once()


@pytest.mark.parametrize(
    "sqlite_session",
    [(Agent, App, Workflow, WorkflowAgentNodeBinding, AgentHomeSnapshot, AgentWorkspace, AgentWorkspaceBinding)],
    indirect=True,
)
def test_retire_unowned_archives_orphan_and_retires_resources(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    agent = _workflow_only_agent(backing_app_id="hidden-app-1")
    hidden_app = App(
        id="hidden-app-1",
        tenant_id="tenant-1",
        name="Inline Agent runtime",
        mode=AppMode.AGENT,
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=True,
    )
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
        app_id=hidden_app.id,
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
        app_id=hidden_app.id,
        workspace_id=workspace.id,
        agent_id=agent.id,
        base_home_snapshot_id=home.id,
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="binding-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
    )
    sqlite_session.add_all([agent, hidden_app, home, workspace, binding])
    sqlite_session.commit()
    monkeypatch.setattr(
        "services.agent.retirement_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )
    cleanup_app = MagicMock()
    enqueue_collection = MagicMock()
    monkeypatch.setattr("services.agent.retirement_service.remove_app_and_related_data_task.delay", cleanup_app)
    monkeypatch.setattr(
        "services.agent.retirement_service.enqueue_agent_resource_collection",
        enqueue_collection,
    )

    WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[agent.id],
        account_id="account-1",
    )

    stored_agent = sqlite_session.get(Agent, agent.id)
    stored_binding = sqlite_session.get(AgentWorkspaceBinding, binding.id)
    stored_workspace = sqlite_session.get(AgentWorkspace, workspace.id)
    stored_home = sqlite_session.get(AgentHomeSnapshot, home.id)
    assert stored_agent is not None
    assert stored_binding is not None
    assert stored_workspace is not None
    assert stored_home is not None
    assert sqlite_session.get(App, hidden_app.id) is None
    assert stored_agent.status is AgentStatus.ARCHIVED
    assert stored_binding.status is AgentWorkingResourceStatus.RETIRED
    assert stored_workspace.status is AgentWorkingResourceStatus.RETIRED
    assert stored_home.status is AgentWorkingResourceStatus.RETIRED
    cleanup_app.assert_called_once_with(tenant_id="tenant-1", app_id=hidden_app.id)
    enqueue_collection.assert_called_once_with(
        tenant_id="tenant-1",
        workspace_ids=[workspace.id],
        binding_ids=[binding.id],
        home_snapshot_ids=[home.id],
        purge_agent_ids=[agent.id],
    )


def test_hidden_app_enqueue_failure_prevents_agent_purge_enqueue(monkeypatch: pytest.MonkeyPatch) -> None:
    context = MagicMock()
    session = context.__enter__.return_value
    session.scalars.side_effect = [
        SimpleNamespace(
            all=MagicMock(
                return_value=[
                    SimpleNamespace(backing_app_id="hidden-app-1"),
                    SimpleNamespace(backing_app_id="hidden-app-2"),
                ]
            )
        ),
        SimpleNamespace(all=MagicMock(return_value=[])),
        SimpleNamespace(all=MagicMock(return_value=[])),
        SimpleNamespace(all=MagicMock(return_value=[])),
        SimpleNamespace(all=MagicMock(return_value=[])),
    ]
    monkeypatch.setattr(
        "services.agent.retirement_service.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(
        WorkflowAgentRetirementService,
        "archive_unowned",
        MagicMock(return_value=["agent-1", "agent-2"]),
    )
    monkeypatch.setattr(AgentWorkspaceService, "retire_all_for_app", MagicMock(return_value=[]))
    monkeypatch.setattr(AgentHomeSnapshotService, "retire_all_for_agent", MagicMock(return_value=[]))
    error = RuntimeError("broker unavailable")
    cleanup_app = MagicMock(side_effect=[None, error])
    monkeypatch.setattr("services.agent.retirement_service.remove_app_and_related_data_task.delay", cleanup_app)
    enqueue_collection = MagicMock()
    monkeypatch.setattr(
        "services.agent.retirement_service.enqueue_agent_resource_collection",
        enqueue_collection,
    )

    with pytest.raises(RuntimeError) as exc_info:
        WorkflowAgentRetirementService.retire_unowned(
            tenant_id="tenant-1",
            agent_ids=["agent-1", "agent-2"],
            account_id="account-1",
        )

    assert exc_info.value is error
    assert [call.kwargs["app_id"] for call in cleanup_app.call_args_list] == ["hidden-app-1", "hidden-app-2"]
    enqueue_collection.assert_not_called()


def test_retire_unowned_retry_after_hidden_app_enqueue_failure_preserves_full_collector_payload(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    agent = _workflow_only_agent(backing_app_id="hidden-app-1")
    hidden_app = App(
        id="hidden-app-1",
        tenant_id="tenant-1",
        name="Inline Agent runtime",
        mode=AppMode.AGENT,
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=False,
    )
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
        app_id=hidden_app.id,
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
        app_id=hidden_app.id,
        workspace_id=workspace.id,
        agent_id=agent.id,
        base_home_snapshot_id=home.id,
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="binding-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
    )
    sqlite_session.add_all([agent, hidden_app, home, workspace, binding])
    sqlite_session.commit()
    agent_id = agent.id
    hidden_app_id = hidden_app.id
    home_id = home.id
    workspace_id = workspace.id
    binding_id = binding.id
    error = RuntimeError("broker unavailable")
    cleanup_app = MagicMock(side_effect=[error, None])
    enqueue_collection = MagicMock()
    monkeypatch.setattr("services.agent.retirement_service.remove_app_and_related_data_task.delay", cleanup_app)
    monkeypatch.setattr(
        "services.agent.retirement_service.enqueue_agent_resource_collection",
        enqueue_collection,
    )

    with pytest.raises(RuntimeError) as exc_info:
        WorkflowAgentRetirementService.retire_unowned(
            tenant_id="tenant-1",
            agent_ids=[agent_id],
            account_id="account-1",
        )

    assert exc_info.value is error
    sqlite_session.expire_all()
    stored_agent = sqlite_session.get(Agent, agent_id)
    stored_workspace = sqlite_session.get(AgentWorkspace, workspace_id)
    stored_binding = sqlite_session.get(AgentWorkspaceBinding, binding_id)
    stored_home = sqlite_session.get(AgentHomeSnapshot, home_id)
    assert stored_agent is not None
    assert stored_workspace is not None
    assert stored_binding is not None
    assert stored_home is not None
    assert stored_agent.status is AgentStatus.ARCHIVED
    assert sqlite_session.get(App, hidden_app_id) is None
    assert stored_workspace.status is AgentWorkingResourceStatus.RETIRED
    assert stored_binding.status is AgentWorkingResourceStatus.RETIRED
    assert stored_home.status is AgentWorkingResourceStatus.RETIRED
    enqueue_collection.assert_not_called()

    WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[agent_id],
        account_id="account-1",
    )

    assert cleanup_app.call_count == 2
    enqueue_collection.assert_called_once_with(
        tenant_id="tenant-1",
        workspace_ids=[workspace_id],
        binding_ids=[binding_id],
        home_snapshot_ids=[home_id],
        purge_agent_ids=[agent_id],
    )
