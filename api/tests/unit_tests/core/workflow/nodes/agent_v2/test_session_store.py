import json
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
from models.workflow import WorkflowNodeExecutionModel
from services.agent.workspace_service import AgentWorkspaceNotFoundError, AgentWorkspaceService
from services.agent_app_sandbox_service import WorkflowAgentSandboxService


def _scope() -> WorkflowAgentSessionScope:
    return WorkflowAgentSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="execution-1",
        workflow_agent_binding_id="workflow-binding-1",
        agent_id="agent-1",
        agent_config_snapshot_id="config-1",
    )


def _binding() -> SimpleNamespace:
    return SimpleNamespace(
        id="binding-1",
        workspace_id="workspace-1",
        agent_id="agent-1",
        base_home_snapshot_id="home-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
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
    )


def test_scope_uses_node_and_workflow_binding_as_workspace_subscope() -> None:
    owner = _scope().workspace_owner
    assert owner.owner_type is AgentWorkspaceOwnerType.WORKFLOW_RUN
    assert owner.owner_id == "run-1"
    assert owner.owner_scope_key == "node-1:workflow-binding-1"


def test_load_existing_scope_reads_the_generation_from_the_persisted_binding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    execution = SimpleNamespace(
        agent_workspace_binding_id="binding-1",
        process_data_dict={"workflow_agent_binding_id": "workflow-binding-1"},
    )
    context = MagicMock()
    store = WorkflowAgentWorkspaceStore()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(store, "_load_execution_by_identity", MagicMock(return_value=execution))
    get_active = MagicMock(return_value=_binding())
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active)

    scope = store.load_existing_node_execution_scope(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="execution-1",
    )

    assert scope is not None
    assert scope.workflow_agent_binding_id == "workflow-binding-1"
    assert scope.agent_id == "agent-1"
    assert scope.agent_config_snapshot_id == "config-1"
    assert get_active.call_args.kwargs["binding_id"] == "binding-1"


def test_load_existing_scope_rejects_unavailable_persisted_binding(monkeypatch: pytest.MonkeyPatch) -> None:
    execution = SimpleNamespace(
        agent_workspace_binding_id="binding-missing",
        process_data_dict={"workflow_agent_binding_id": "workflow-binding-1"},
    )
    context = MagicMock()
    store = WorkflowAgentWorkspaceStore()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(store, "_load_execution_by_identity", MagicMock(return_value=execution))
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=None))

    with pytest.raises(AgentWorkspaceNotFoundError, match="participant Binding is unavailable"):
        store.load_existing_node_execution_scope(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_run_id="run-1",
            node_id="node-1",
            node_execution_id="execution-1",
        )


def test_load_or_create_persists_binding_on_node_execution(monkeypatch) -> None:
    execution = WorkflowNodeExecutionModel(
        agent_workspace_binding_id=None,
        process_data=json.dumps({"existing": "value"}),
    )
    context = MagicMock()
    session = context.__enter__.return_value
    create = MagicMock(return_value=_binding())
    store = WorkflowAgentWorkspaceStore()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(store, "_load_execution", MagicMock(return_value=execution))
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)

    stored = store.load_or_create_node_execution_session(_scope(), home_snapshot_id="home-1")

    assert stored.binding_id == "binding-1"
    assert stored.workspace_id == "workspace-1"
    assert stored.backend_binding_ref == "backend-binding-1"
    assert execution.agent_workspace_binding_id == "binding-1"
    assert execution.process_data_dict == {
        "existing": "value",
        "workflow_agent_binding_id": "workflow-binding-1",
    }
    assert "agent_workspace_binding_id" not in execution.process_data_dict
    assert create.call_args.kwargs["session"] is session
    session.commit.assert_called_once_with()

    get_active = MagicMock(return_value=_binding())
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active)
    session.scalar.return_value = execution
    resolved = WorkflowAgentSandboxService._resolve_binding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="execution-1",
        session=session,
    )

    assert resolved.id == "binding-1"
    owner_scope = get_active.call_args.kwargs["expected_owner_scope"]
    assert owner_scope.owner_scope_key == "node-1:workflow-binding-1"


def test_load_existing_pointer_rejects_missing_workflow_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    execution = SimpleNamespace(
        agent_workspace_binding_id="binding-1",
        process_data=json.dumps({"existing": "value"}),
        process_data_dict={"existing": "value"},
    )
    context = MagicMock()
    session = context.__enter__.return_value
    store = WorkflowAgentWorkspaceStore()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(store, "_load_execution", MagicMock(return_value=execution))
    get_active = MagicMock()
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active)

    with pytest.raises(AgentWorkspaceNotFoundError, match="caller identity is missing"):
        store.load_or_create_node_execution_session(_scope(), home_snapshot_id="home-1")

    assert json.loads(execution.process_data) == {"existing": "value"}
    get_active.assert_not_called()
    session.commit.assert_not_called()


def test_load_existing_pointer_reuses_matching_workflow_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    original_process_data = json.dumps(
        {
            "existing": "value",
            "workflow_agent_binding_id": "workflow-binding-1",
        }
    )
    execution = SimpleNamespace(
        agent_workspace_binding_id="binding-1",
        process_data=original_process_data,
        process_data_dict=json.loads(original_process_data),
    )
    context = MagicMock()
    session = context.__enter__.return_value
    store = WorkflowAgentWorkspaceStore()
    create = MagicMock()
    binding = _binding()
    validate_generation = MagicMock()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(store, "_load_execution", MagicMock(return_value=execution))
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=binding))
    monkeypatch.setattr(AgentWorkspaceService, "validate_binding_generation", validate_generation)

    stored = store.load_or_create_node_execution_session(_scope(), home_snapshot_id="home-1")

    assert stored.binding_id == "binding-1"
    assert execution.process_data == original_process_data
    assert "agent_workspace_binding_id" not in execution.process_data_dict
    create.assert_not_called()
    session.commit.assert_not_called()
    validate_generation.assert_called_once_with(
        binding,
        base_home_snapshot_id="home-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
    )


def test_load_existing_pointer_rejects_conflicting_workflow_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    execution = SimpleNamespace(
        agent_workspace_binding_id="binding-1",
        process_data=json.dumps({"workflow_agent_binding_id": "workflow-binding-other"}),
        process_data_dict={"workflow_agent_binding_id": "workflow-binding-other"},
    )
    context = MagicMock()
    session = context.__enter__.return_value
    store = WorkflowAgentWorkspaceStore()
    get_active = MagicMock()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(store, "_load_execution", MagicMock(return_value=execution))
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active)

    with pytest.raises(AgentWorkspaceNotFoundError, match="caller identity does not match"):
        store.load_or_create_node_execution_session(_scope(), home_snapshot_id="home-1")

    get_active.assert_not_called()
    session.commit.assert_not_called()


def test_load_or_create_fails_before_binding_create_when_caller_row_is_missing(monkeypatch) -> None:
    context = MagicMock()
    session = context.__enter__.return_value
    create = MagicMock()
    sleep = MagicMock()
    store = WorkflowAgentWorkspaceStore()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr("core.workflow.nodes.agent_v2.session_store.time.sleep", sleep)
    monkeypatch.setattr(session, "scalar", MagicMock(return_value=None))
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)

    with pytest.raises(AgentWorkspaceNotFoundError, match="Workflow node execution caller is unavailable"):
        store.load_or_create_node_execution_session(_scope(), home_snapshot_id="home-1")

    assert session.scalar.call_count == 20
    assert sleep.call_count == 19
    create.assert_not_called()
    session.commit.assert_not_called()


def test_load_existing_scope_waits_for_caller_row_to_become_visible(monkeypatch: pytest.MonkeyPatch) -> None:
    execution = SimpleNamespace(agent_workspace_binding_id=None)
    context = MagicMock()
    session = context.__enter__.return_value
    session.scalar.side_effect = [None, None, execution]
    sleep = MagicMock()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr("core.workflow.nodes.agent_v2.session_store.time.sleep", sleep)

    scope = WorkflowAgentWorkspaceStore().load_existing_node_execution_scope(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="execution-1",
    )

    assert scope is None
    assert session.scalar.call_count == 3
    assert sleep.call_count == 2


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
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )

    workspace_ids = WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
    )

    assert matching.status is AgentWorkingResourceStatus.RETIRED
    assert other_tenant.status is AgentWorkingResourceStatus.ACTIVE
    assert other_app.status is AgentWorkingResourceStatus.ACTIVE
    assert workspace_ids == [matching.id]


@pytest.mark.parametrize("sqlite_session", [(AgentWorkspace, AgentWorkspaceBinding)], indirect=True)
def test_retire_workflow_run_transitions_active_workspace(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    workspace = _workspace_row()
    binding = _binding_row()
    sqlite_session.add_all([workspace, binding])
    sqlite_session.commit()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )

    workspace_ids = WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
    )

    assert workspace.status is AgentWorkingResourceStatus.RETIRED
    assert binding.status is AgentWorkingResourceStatus.RETIRED
    assert workspace_ids == [workspace.id]


def test_retire_workflow_run_returns_existing_retired_workspace(monkeypatch) -> None:
    workspace = _workspace_row(status=AgentWorkingResourceStatus.RETIRED)
    context = MagicMock()
    session = context.__enter__.return_value
    session.scalars.return_value.all.return_value = [workspace]
    retire = MagicMock()
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.session_store.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr(AgentWorkspaceService, "retire_workspace", retire)

    workspace_ids = WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
    )

    retire.assert_not_called()
    assert workspace_ids == [workspace.id]
