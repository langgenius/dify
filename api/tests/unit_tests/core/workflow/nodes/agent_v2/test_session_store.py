import json
from collections.abc import Iterator
from contextlib import nullcontext
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol import CreateExecutionBindingRequest, CreateExecutionBindingResponse
from dify_agent.runtime_backend.errors import SharedWorkspaceUnsupportedError
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope, WorkflowAgentWorkspaceStore
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType
from models.agent import (
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
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


def _execution_row(
    *,
    execution_id: str = "execution-1",
    binding_id: str | None = None,
    process_data: dict[str, object] | None = None,
) -> WorkflowNodeExecutionModel:
    return WorkflowNodeExecutionModel(
        id=execution_id,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id="run-1",
        index=1,
        predecessor_node_id=None,
        node_execution_id=execution_id,
        node_id="node-1",
        node_type="agent",
        title="Agent",
        agent_workspace_binding_id=binding_id,
        inputs="{}",
        process_data=json.dumps(process_data) if process_data is not None else None,
        outputs=None,
        status=WorkflowNodeExecutionStatus.RUNNING,
        error=None,
        elapsed_time=0,
        execution_metadata=None,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        finished_at=None,
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
    base_home_snapshot_id: str | None = "home-1",
) -> AgentWorkspaceBinding:
    return AgentWorkspaceBinding(
        id=binding_id,
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id=workspace_id,
        agent_id="agent-1",
        base_home_snapshot_id=base_home_snapshot_id,
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="backend-binding-1" if binding_id == "binding-1" else f"{binding_id}-ref",
        status=status,
    )


def _home_snapshot() -> AgentHomeSnapshot:
    return AgentHomeSnapshot(
        id="home-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        snapshot_ref="home-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
    )


def _install_backend_client(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    client = MagicMock()
    client.create_execution_binding_sync.return_value = SimpleNamespace(
        binding_ref="backend-binding-1",
        workspace_ref="workspace-1-ref",
    )
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(client))
    return client


@pytest.fixture
def executed_statements(sqlite_engine: Engine) -> Iterator[list[str]]:
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        yield statements
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)


def _execution_selects(statements: list[str]) -> list[str]:
    return [statement for statement in statements if "FROM workflow_node_executions" in statement]


def test_scope_uses_node_and_workflow_binding_as_workspace_subscope() -> None:
    owner = _scope().workspace_owner
    assert owner.owner_type is AgentWorkspaceOwnerType.WORKFLOW_RUN
    assert owner.owner_id == "run-1"
    assert owner.owner_scope_key == "node-1:workflow-binding-1"


@pytest.mark.parametrize("overlap", [False, True], ids=["sequential", "overlapping-allocation"])
def test_workflow_tool_calls_allocate_distinct_agent_workspaces(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, overlap: bool
) -> None:
    first = _execution_row()
    second = _execution_row(execution_id="execution-2")
    first.triggered_from = second.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
    sqlite_session.add_all([first, second])
    sqlite_session.commit()
    scopes = [
        replace(_scope(), node_execution_id=execution.id, workflow_tool_invocation_id=invocation_id)
        for execution, invocation_id in ((first, "tool-call-1"), (second, "tool-call-2"))
    ]
    store = WorkflowAgentWorkspaceStore()
    client = MagicMock()
    allocation_requests: list[CreateExecutionBindingRequest] = []

    def allocate(request: CreateExecutionBindingRequest) -> CreateExecutionBindingResponse:
        allocation_requests.append(request)
        # Match providers such as E2B and Enterprise, which cannot create a new
        # participant attached to an existing Workspace.
        if request.existing_workspace_ref is not None:
            raise SharedWorkspaceUnsupportedError("cannot attach to an existing Workspace")
        if overlap and len(allocation_requests) == 1:
            # The second caller commits after the first resolved its owner, but
            # before the first allocation returns. This reproduces the race
            # without relying on thread timing or SQLite write-lock behavior.
            store.load_or_create_node_execution_session(scopes[1], home_snapshot_id=None)
        return CreateExecutionBindingResponse(
            binding_ref=f"binding-{request.binding_id}", workspace_ref=f"workspace-{request.workspace_id}"
        )

    client.create_execution_binding_sync.side_effect = allocate
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(client))
    store.load_or_create_node_execution_session(scopes[0], home_snapshot_id=None)
    if not overlap:
        store.load_or_create_node_execution_session(scopes[1], home_snapshot_id=None)

    sqlite_session.expire_all()
    workspaces = list(sqlite_session.scalars(select(AgentWorkspace)))
    assert len(workspaces) == 2
    assert len({workspace.owner_scope_key for workspace in workspaces}) == 2
    assert {workspace.owner_id for workspace in workspaces} == {"run-1"}
    bindings = list(sqlite_session.scalars(select(AgentWorkspaceBinding)))
    assert len({binding.workspace_id for binding in bindings}) == 2
    assert first.agent_workspace_binding_id != second.agent_workspace_binding_id


def test_workflow_tool_agent_workspace_identity_survives_resume(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    execution = _execution_row()
    execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
    sqlite_session.add(execution)
    sqlite_session.commit()
    client = _install_backend_client(monkeypatch)
    scope = replace(_scope(), workflow_tool_invocation_id="tool-call-1")
    stored = WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(scope, home_snapshot_id=None)
    snapshot = CompositorSessionSnapshot(layers=[])
    WorkflowAgentWorkspaceStore().save_active_snapshot(
        scope=scope,
        binding_id=stored.binding_id,
        snapshot=snapshot,
        pending_form_id="form-1",
        pending_tool_call_id="ask-human-1",
    )

    resumed_store = WorkflowAgentWorkspaceStore()
    restored_scope = resumed_store.load_existing_node_execution_scope(
        tenant_id=scope.tenant_id,
        app_id=scope.app_id,
        workflow_id=scope.workflow_id,
        workflow_run_id=scope.workflow_run_id,
        node_id=scope.node_id,
        node_execution_id=scope.node_execution_id,
        workflow_tool_invocation_id="tool-call-1",
    )
    assert restored_scope is not None
    assert restored_scope == scope
    resumed = resumed_store.load_or_create_node_execution_session(restored_scope, home_snapshot_id=None)
    assert (resumed.workspace_id, resumed.binding_id) == (stored.workspace_id, stored.binding_id)
    assert resumed.session_snapshot == snapshot
    assert (resumed.pending_form_id, resumed.pending_tool_call_id) == ("form-1", "ask-human-1")
    client.create_execution_binding_sync.assert_called_once()
    sqlite_session.expire_all()
    inspected = WorkflowAgentSandboxService._resolve_binding(
        tenant_id=scope.tenant_id,
        app_id=scope.app_id,
        workflow_run_id="run-1",
        node_id=scope.node_id,
        node_execution_id=scope.node_execution_id,
        session=sqlite_session,
    )
    assert inspected.backend_binding_ref == stored.backend_binding_ref

    with pytest.raises(AgentWorkspaceNotFoundError, match="caller invocation does not match"):
        resumed_store.load_existing_node_execution_scope(
            tenant_id=scope.tenant_id,
            app_id=scope.app_id,
            workflow_id=scope.workflow_id,
            workflow_run_id=scope.workflow_run_id,
            node_id=scope.node_id,
            node_execution_id=scope.node_execution_id,
            workflow_tool_invocation_id="another-tool-call",
        )


def test_agent_executions_within_one_workflow_tool_invocation_keep_workspace_sharing(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    first = _execution_row()
    second = _execution_row(execution_id="iteration-2-execution")
    first.triggered_from = second.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
    sqlite_session.add_all([first, second])
    sqlite_session.commit()
    _install_backend_client(monkeypatch)
    store = WorkflowAgentWorkspaceStore()
    scope = replace(_scope(), workflow_tool_invocation_id="tool-call-1")

    first_session = store.load_or_create_node_execution_session(scope, home_snapshot_id=None)
    second_session = store.load_or_create_node_execution_session(
        replace(scope, node_execution_id=second.id), home_snapshot_id=None
    )

    assert first_session.workspace_id == second_session.workspace_id
    assert first_session.binding_id != second_session.binding_id
    assert sqlite_session.scalar(select(func.count()).select_from(AgentWorkspace)) == 1


def test_load_existing_scope_reads_the_generation_from_the_persisted_binding(sqlite_session: Session) -> None:
    sqlite_session.add_all(
        [
            _execution_row(
                binding_id="binding-1",
                process_data={"workflow_agent_binding_id": "workflow-binding-1"},
            ),
            _workspace_row(),
            _binding_row(),
        ]
    )
    sqlite_session.commit()

    scope = WorkflowAgentWorkspaceStore().load_existing_node_execution_scope(
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


def test_load_existing_scope_rejects_unavailable_persisted_binding(sqlite_session: Session) -> None:
    sqlite_session.add(
        _execution_row(
            binding_id="binding-missing",
            process_data={"workflow_agent_binding_id": "workflow-binding-1"},
        )
    )
    sqlite_session.commit()

    with pytest.raises(AgentWorkspaceNotFoundError, match="participant Binding is unavailable"):
        WorkflowAgentWorkspaceStore().load_existing_node_execution_scope(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_run_id="run-1",
            node_id="node-1",
            node_execution_id="execution-1",
        )


@pytest.mark.parametrize("home_snapshot_id", ["home-1", None])
def test_load_or_create_persists_binding_on_node_execution(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    home_snapshot_id: str | None,
) -> None:
    execution = _execution_row(process_data={"existing": "value"})
    rows: list[object] = [execution]
    if home_snapshot_id is not None:
        rows.append(_home_snapshot())
    sqlite_session.add_all(rows)
    sqlite_session.commit()
    _install_backend_client(monkeypatch)

    stored = WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(
        _scope(), home_snapshot_id=home_snapshot_id
    )

    sqlite_session.expire_all()
    persisted_execution = sqlite_session.get(WorkflowNodeExecutionModel, execution.id)
    assert persisted_execution is not None
    assert stored.workspace_id
    assert stored.backend_binding_ref == "backend-binding-1"
    assert persisted_execution.agent_workspace_binding_id == stored.binding_id
    assert persisted_execution.process_data_dict == {
        "existing": "value",
        "workflow_agent_binding_id": "workflow-binding-1",
    }
    assert "agent_workspace_binding_id" not in persisted_execution.process_data_dict
    persisted_binding = sqlite_session.get(AgentWorkspaceBinding, stored.binding_id)
    assert persisted_binding is not None
    assert persisted_binding.base_home_snapshot_id == home_snapshot_id

    resolved = WorkflowAgentSandboxService._resolve_binding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
        node_id="node-1",
        node_execution_id="execution-1",
        session=sqlite_session,
    )

    assert resolved.backend_binding_ref == "backend-binding-1"
    assert resolved.agent_id == "agent-1"
    assert resolved.agent_config_version_id == "config-1"
    assert resolved.agent_config_version_kind == "snapshot"


def test_load_existing_pointer_rejects_missing_workflow_identity(sqlite_session: Session) -> None:
    execution = _execution_row(binding_id="binding-1", process_data={"existing": "value"})
    sqlite_session.add(execution)
    sqlite_session.commit()

    with pytest.raises(AgentWorkspaceNotFoundError, match="caller identity is missing"):
        WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(_scope(), home_snapshot_id="home-1")

    sqlite_session.expire(execution)
    assert execution.process_data_dict == {"existing": "value"}
    assert sqlite_session.scalar(select(func.count()).select_from(AgentWorkspaceBinding)) == 0


def test_load_existing_pointer_reuses_matching_workflow_identity(sqlite_session: Session) -> None:
    original_process_data = {
        "existing": "value",
        "workflow_agent_binding_id": "workflow-binding-1",
    }
    execution = _execution_row(binding_id="binding-1", process_data=original_process_data)
    sqlite_session.add_all([execution, _workspace_row(), _binding_row()])
    sqlite_session.commit()

    stored = WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(_scope(), home_snapshot_id="home-1")

    sqlite_session.expire(execution)
    assert stored.binding_id == "binding-1"
    assert execution.process_data_dict == original_process_data
    assert "agent_workspace_binding_id" not in execution.process_data_dict
    assert sqlite_session.scalar(select(func.count()).select_from(AgentWorkspaceBinding)) == 1


def test_load_existing_pointer_rejects_conflicting_workflow_identity(sqlite_session: Session) -> None:
    execution = _execution_row(
        binding_id="binding-1",
        process_data={"workflow_agent_binding_id": "workflow-binding-other"},
    )
    sqlite_session.add(execution)
    sqlite_session.commit()

    with pytest.raises(AgentWorkspaceNotFoundError, match="caller identity does not match"):
        WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(_scope(), home_snapshot_id="home-1")

    assert sqlite_session.scalar(select(func.count()).select_from(AgentWorkspaceBinding)) == 0


def test_load_or_create_fails_before_binding_create_when_caller_row_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    executed_statements: list[str],
) -> None:
    sleep = MagicMock()
    monkeypatch.setattr("core.workflow.nodes.agent_v2.session_store.time.sleep", sleep)

    with pytest.raises(AgentWorkspaceNotFoundError, match="Workflow node execution caller is unavailable"):
        WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(_scope(), home_snapshot_id="home-1")

    assert len(_execution_selects(executed_statements)) == 60
    assert sleep.call_count == 59
    assert sqlite_session.scalar(select(func.count()).select_from(AgentWorkspaceBinding)) == 0


def test_load_existing_scope_waits_for_caller_row_to_become_visible(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    executed_statements: list[str],
) -> None:
    sleep = MagicMock()

    def make_caller_visible(_seconds: float) -> None:
        if sleep.call_count == 2:
            with sqlite_session_factory() as observer:
                observer.add(_execution_row())
                observer.commit()

    sleep.side_effect = make_caller_visible
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
    assert len(_execution_selects(executed_statements)) == 3
    assert sleep.call_count == 2


def test_save_snapshot_targets_binding(sqlite_session: Session) -> None:
    binding = _binding_row()
    sqlite_session.add_all([_workspace_row(), binding])
    sqlite_session.commit()
    snapshot = CompositorSessionSnapshot(layers=[])

    WorkflowAgentWorkspaceStore().save_active_snapshot(
        scope=_scope(),
        binding_id=binding.id,
        snapshot=snapshot,
    )

    sqlite_session.expire(binding)
    assert binding.session_snapshot == snapshot.model_dump_json()


def test_retire_workflow_run_only_retires_matching_tenant_and_app(sqlite_session: Session) -> None:
    matching = _workspace_row()
    other_tenant = _workspace_row(workspace_id="workspace-other-tenant", tenant_id="tenant-2")
    other_app = _workspace_row(
        workspace_id="workspace-other-app",
        app_id="app-2",
        owner_scope_key="node-2:workflow-binding-2",
    )
    sqlite_session.add_all([matching, other_tenant, other_app])
    sqlite_session.commit()

    workspace_ids = WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
    )

    sqlite_session.expire_all()
    assert matching.status is AgentWorkingResourceStatus.RETIRED
    assert other_tenant.status is AgentWorkingResourceStatus.ACTIVE
    assert other_app.status is AgentWorkingResourceStatus.ACTIVE
    assert workspace_ids == [matching.id]


def test_retire_workflow_run_transitions_active_workspace(sqlite_session: Session) -> None:
    workspace = _workspace_row()
    binding = _binding_row()
    sqlite_session.add_all([workspace, binding])
    sqlite_session.commit()

    workspace_ids = WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
    )

    sqlite_session.expire_all()
    assert workspace.status is AgentWorkingResourceStatus.RETIRED
    assert binding.status is AgentWorkingResourceStatus.RETIRED
    assert workspace_ids == [workspace.id]


def test_retire_workflow_run_returns_existing_retired_workspace(sqlite_session: Session) -> None:
    workspace = _workspace_row(status=AgentWorkingResourceStatus.RETIRED)
    sqlite_session.add(workspace)
    sqlite_session.commit()

    workspace_ids = WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
    )

    sqlite_session.expire(workspace)
    assert workspace.status is AgentWorkingResourceStatus.RETIRED
    assert workspace_ids == [workspace.id]


@pytest.mark.parametrize("caller_app", ["app-1", "unrelated-app"])
def test_retire_workflow_tool_workspace_follows_persisted_run_owner(sqlite_session: Session, caller_app: str) -> None:
    run = WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="1",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.SUCCEEDED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
    )
    workspace = _workspace_row(app_id="source-app")
    binding = _binding_row()
    binding.app_id = "source-app"
    execution = _execution_row(binding_id=binding.id)
    execution.app_id = "source-app"
    execution.workflow_id = "source-workflow"
    execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
    unlinked_workspace = _workspace_row(
        workspace_id="unlinked-workspace", app_id="source-app", owner_scope_key="unlinked"
    )
    sqlite_session.add_all([run, workspace, binding, execution, unlinked_workspace])
    sqlite_session.commit()

    result = WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id="tenant-1", app_id=caller_app, workflow_run_id=run.id
    )

    sqlite_session.expire_all()
    assert unlinked_workspace.status is AgentWorkingResourceStatus.ACTIVE
    if caller_app == "app-1":
        assert result == [workspace.id]
        assert workspace.status is AgentWorkingResourceStatus.RETIRED
        assert binding.status is AgentWorkingResourceStatus.RETIRED
    else:
        assert result == []
        assert workspace.status is AgentWorkingResourceStatus.ACTIVE
        assert binding.status is AgentWorkingResourceStatus.ACTIVE
