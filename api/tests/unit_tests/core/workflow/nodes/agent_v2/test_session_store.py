import json
from collections.abc import Iterator
from contextlib import nullcontext
from dataclasses import replace
from datetime import datetime
from types import SimpleNamespace
from typing import override
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from dify_agent.protocol import CreateExecutionBindingRequest, CreateExecutionBindingResponse
from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.runtime_backend.errors import SharedWorkspaceUnsupportedError
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.node_execution import WorkflowNodeExecution
from core.workflow.node_execution_process_data import WORKFLOW_TOOL_ROOT_APP_ID_KEY
from core.workflow.nodes.agent_v2.session_store import (
    WorkflowAgentSessionScope,
    WorkflowAgentWorkspaceStore,
    resolve_workflow_agent_workspace_owner_scope,
)
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType
from models.agent import (
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.enums import ConversationFromSource, CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, IconType
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from models.workflow import WorkflowType as ModelWorkflowType
from repositories.agent.agent_sandbox_repository import AgentSandboxRepository
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.agent.sandbox_contracts import AgentSandboxBindingNotFoundError
from services.agent.workspace_service import AgentWorkspaceNotFoundError, AgentWorkspaceService
from services.app_service import AppService
from tests.helpers.unit.model_factories import make_account, make_conversation, make_message


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
    workflow_run_id: str = "run-1",
    binding_id: str | None = None,
    process_data: dict[str, object] | None = None,
) -> WorkflowNodeExecutionModel:
    return WorkflowNodeExecutionModel(
        id=execution_id,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id=workflow_run_id,
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


class _WorkspaceAllocationRecorder:
    """Record allocation requests and return a unique backend resource for each identity."""

    def __init__(self) -> None:
        self.requests: list[CreateExecutionBindingRequest] = []

    def create_execution_binding_sync(self, request: CreateExecutionBindingRequest) -> CreateExecutionBindingResponse:
        """Accept a validated request and record one allocation without performing external I/O."""
        self.requests.append(request)
        return CreateExecutionBindingResponse(
            binding_ref=f"binding-{request.binding_id}",
            workspace_ref=request.existing_workspace_ref or f"workspace-{request.workspace_id}",
        )


def _record_workspace_allocations(monkeypatch: pytest.MonkeyPatch) -> _WorkspaceAllocationRecorder:
    """Replace only the backend allocation boundary; preserve the real database lifecycle."""
    recorder = _WorkspaceAllocationRecorder()
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(recorder))
    return recorder


@pytest.fixture
def executed_statements(sqlite_engine: Engine) -> Iterator[list[str]]:
    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
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


def test_resolve_workspace_owner_scope_uses_conversation_for_chatflow() -> None:
    owner = resolve_workflow_agent_workspace_owner_scope(
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id="conversation-1",
        workflow_run_id="run-1",
        node_id="node-1",
        workflow_agent_binding_id="workflow-binding-1",
    )
    assert owner.owner_type is AgentWorkspaceOwnerType.CONVERSATION
    assert owner.owner_id == "conversation-1"
    assert owner.owner_scope_key == "node-1:workflow-binding-1"


def test_resolve_workspace_owner_scope_keeps_workflow_run_for_pure_workflow() -> None:
    owner = resolve_workflow_agent_workspace_owner_scope(
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id=None,
        workflow_run_id="run-1",
        node_id="node-1",
        workflow_agent_binding_id="workflow-binding-1",
        node_execution_id="execution-1",
    )
    assert owner.owner_type is AgentWorkspaceOwnerType.WORKFLOW_RUN
    assert owner.owner_id == "run-1"


def test_conversation_scope_reuses_existing_binding_on_later_turn(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    prior_snapshot = SessionSnapshot(layers={"history": {"turn": 1}})
    workspace = AgentWorkspace(
        id="workspace-conversation",
        tenant_id="tenant-1",
        app_id="app-1",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation-1",
        owner_scope_key="node-1:workflow-binding-1",
        backend_workspace_ref="workspace-1-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )
    prior_binding = AgentWorkspaceBinding(
        id="binding-prior",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id=workspace.id,
        agent_id="agent-1",
        base_home_snapshot_id="home-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="backend-binding-prior",
        status=AgentWorkingResourceStatus.ACTIVE,
        session_snapshot=prior_snapshot.model_dump_json(),
    )
    execution = _execution_row(
        execution_id="execution-2",
        workflow_run_id="run-2",
        process_data={"workflow_agent_binding_id": "workflow-binding-1"},
    )
    sqlite_session.add_all([_home_snapshot(), workspace, prior_binding, execution])
    sqlite_session.commit()
    client = _install_backend_client(monkeypatch)

    scope = WorkflowAgentSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="run-2",
        node_id="node-1",
        node_execution_id="execution-2",
        workflow_agent_binding_id="workflow-binding-1",
        agent_id="agent-1",
        agent_config_snapshot_id="config-1",
        conversation_id="conversation-1",
    )
    stored = WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(scope, home_snapshot_id="home-1")

    assert stored.workspace_id == workspace.id
    assert stored.binding_id == prior_binding.id
    assert stored.session_snapshot == prior_snapshot
    client.create_execution_binding_sync.assert_not_called()
    assert sqlite_session.scalar(select(func.count()).select_from(AgentWorkspaceBinding)) == 1


def test_disabled_chatflow_session_is_owned_by_the_current_run() -> None:
    """Given a Chatflow with continuity disabled, only its current run owns the Workspace."""
    scope = replace(_scope(), conversation_id="conversation-1", continue_agent_session=False)

    assert scope.workspace_owner.owner_type is AgentWorkspaceOwnerType.WORKFLOW_RUN
    assert scope.workspace_owner.owner_id == "run-1"
    assert replace(scope, workflow_run_id="run-2").workspace_owner != scope.workspace_owner


@pytest.mark.parametrize("continue_agent_session", [True, False])
def test_chatflow_generation_partitions_workspace_scope_and_bounds_key_length(continue_agent_session: bool) -> None:
    """Given a new generation, reject the legacy namespace without exceeding the database key limit."""
    scope = replace(
        _scope(),
        node_id="n" * 255,
        conversation_id="conversation-1",
        continue_agent_session=continue_agent_session,
    )
    first_generation = replace(scope, session_generation=str(uuid4()))
    next_generation = replace(scope, session_generation=str(uuid4()))

    assert first_generation.workspace_owner.owner_scope_key != scope.workspace_owner.owner_scope_key
    assert first_generation.workspace_owner != next_generation.workspace_owner
    assert len(first_generation.workspace_owner.owner_scope_key) <= 255
    assert replace(first_generation).workspace_owner == first_generation.workspace_owner


def test_chatflow_session_setting_does_not_change_workflow_tool_workspace_scope() -> None:
    """Given a Workflow Tool invocation, Chatflow settings cannot change its existing scope."""
    scope = replace(_scope(), conversation_id="conversation-1", workflow_tool_invocation_id="tool-call-1")
    disabled = replace(scope, continue_agent_session=False, session_generation=str(uuid4()), session_branch="a" * 64)

    assert disabled.workspace_owner == scope.workspace_owner


@pytest.mark.parametrize("continue_agent_session", [True, False])
@pytest.mark.parametrize("session_generation", ["", "00000000-0000-4000-8000-000000000001"])
def test_chatflow_parallel_branches_have_independent_workspace_scopes(
    continue_agent_session: bool, session_generation: str
) -> None:
    """Given sibling parallel branches, neither can address the other's or the unbranched Workspace."""
    scope = replace(
        _scope(),
        conversation_id="conversation-1",
        continue_agent_session=continue_agent_session,
        session_generation=session_generation,
    )
    first_branch = replace(scope, session_branch="a" * 64)
    second_branch = replace(scope, session_branch="b" * 64)

    assert first_branch.workspace_owner != second_branch.workspace_owner
    assert first_branch.workspace_owner != scope.workspace_owner
    assert second_branch.workspace_owner != scope.workspace_owner
    assert len(first_branch.workspace_owner.owner_scope_key) <= 255


@pytest.mark.parametrize("continue_agent_session", [True, False])
def test_chatflow_parallel_branches_never_merge_history_or_workspace_and_keep_sequential_reuse(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, continue_agent_session: bool
) -> None:
    """Given interleaved branches, isolate resources while repeat visits reuse only their own branch."""
    sqlite_session.add_all(
        [
            _execution_row(),
            _execution_row(execution_id="parallel-execution"),
            _execution_row(execution_id="repeat-execution"),
            _execution_row(execution_id="next-message-execution", workflow_run_id="run-2"),
        ]
    )
    sqlite_session.commit()
    allocations = _record_workspace_allocations(monkeypatch)
    store = WorkflowAgentWorkspaceStore()
    scope = replace(
        _scope(),
        conversation_id="conversation-1",
        continue_agent_session=continue_agent_session,
        session_generation=str(uuid4()),
        session_branch="a" * 64,
    )
    first = store.load_or_create_node_execution_session(scope, home_snapshot_id=None)
    first_snapshot = SessionSnapshot(layers={"history": {"branch_a_only": "private working state"}})
    store.save_active_snapshot(scope=scope, binding_id=first.binding_id, snapshot=first_snapshot)

    other_branch = store.load_or_create_node_execution_session(
        replace(scope, node_execution_id="parallel-execution", session_branch="b" * 64), home_snapshot_id=None
    )
    repeated = store.load_or_create_node_execution_session(
        replace(scope, node_execution_id="repeat-execution"), home_snapshot_id=None
    )
    next_message = store.load_or_create_node_execution_session(
        replace(scope, workflow_run_id="run-2", node_execution_id="next-message-execution"), home_snapshot_id=None
    )

    assert other_branch.binding_id != first.binding_id
    assert other_branch.workspace_id != first.workspace_id
    assert other_branch.session_snapshot is None
    assert repeated.binding_id == first.binding_id
    assert repeated.workspace_id == first.workspace_id
    assert repeated.session_snapshot == first_snapshot
    if continue_agent_session:
        assert next_message.binding_id == first.binding_id
        assert next_message.session_snapshot == first_snapshot
        assert len(allocations.requests) == 2
    else:
        assert next_message.binding_id not in {first.binding_id, other_branch.binding_id}
        assert next_message.workspace_id not in {first.workspace_id, other_branch.workspace_id}
        assert next_message.session_snapshot is None
        assert len(allocations.requests) == 3
    assert all(request.existing_workspace_ref is None for request in allocations.requests)


@pytest.mark.parametrize("continue_agent_session", [True, False])
def test_parallel_branch_first_allocations_can_overlap_without_sharing_resources(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, continue_agent_session: bool
) -> None:
    """Given overlapping first allocations, each branch commits its own resources without owner-key conflicts."""
    sqlite_session.add_all([_execution_row(), _execution_row(execution_id="parallel-execution")])
    sqlite_session.commit()
    store = WorkflowAgentWorkspaceStore()
    first_scope = replace(
        _scope(),
        conversation_id="conversation-1",
        continue_agent_session=continue_agent_session,
        session_branch="a" * 64,
    )
    second_scope = replace(first_scope, node_execution_id="parallel-execution", session_branch="b" * 64)
    overlapping: list[str] = []

    class InterleavingAllocations(_WorkspaceAllocationRecorder):
        @override
        def create_execution_binding_sync(
            self, request: CreateExecutionBindingRequest
        ) -> CreateExecutionBindingResponse:
            """Commit the other branch while the initial backend allocation is still in progress."""
            result = super().create_execution_binding_sync(request)
            if len(self.requests) == 1:
                overlapping.append(
                    store.load_or_create_node_execution_session(second_scope, home_snapshot_id=None).workspace_id
                )
            return result

    allocations = InterleavingAllocations()
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(allocations))

    first = store.load_or_create_node_execution_session(first_scope, home_snapshot_id=None)

    assert len(overlapping) == 1
    assert first.workspace_id != overlapping[0]
    assert len(allocations.requests) == 2
    assert all(request.existing_workspace_ref is None for request in allocations.requests)
    assert sqlite_session.scalar(select(func.count()).select_from(AgentWorkspace)) == 2
    assert sqlite_session.scalar(select(func.count()).select_from(AgentWorkspaceBinding)) == 2


def test_disabled_chatflow_messages_allocate_independent_history_and_workspaces(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Given two messages in one chat, neither history nor a mutable Workspace crosses runs."""
    first_execution = _execution_row()
    second_execution = _execution_row(execution_id="execution-2", workflow_run_id="run-2")
    sqlite_session.add_all([first_execution, second_execution])
    sqlite_session.commit()
    allocations = _record_workspace_allocations(monkeypatch)
    store = WorkflowAgentWorkspaceStore()
    first_scope = replace(
        _scope(), conversation_id="conversation-1", continue_agent_session=False, session_generation=str(uuid4())
    )

    first = store.load_or_create_node_execution_session(first_scope, home_snapshot_id=None)
    store.save_active_snapshot(
        scope=first_scope,
        binding_id=first.binding_id,
        snapshot=SessionSnapshot(layers={"history": {"secret_from_first_message": True}}),
    )
    second = store.load_or_create_node_execution_session(
        replace(first_scope, workflow_run_id="run-2", node_execution_id=second_execution.id), home_snapshot_id=None
    )

    assert second.workspace_id != first.workspace_id
    assert second.binding_id != first.binding_id
    assert second.backend_binding_ref != first.backend_binding_ref
    assert second.session_snapshot is None
    assert len(allocations.requests) == 2
    assert all(request.existing_workspace_ref is None for request in allocations.requests)


def test_disabled_chatflow_sequential_executions_share_this_round_history_and_workspace(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Given sequential visits in one message's run, reuse its participant and accumulated history."""
    first_execution = _execution_row()
    second_execution = _execution_row(execution_id="iteration-2-execution")
    sqlite_session.add_all([first_execution, second_execution])
    sqlite_session.commit()
    allocations = _record_workspace_allocations(monkeypatch)
    store = WorkflowAgentWorkspaceStore()
    scope = replace(
        _scope(), conversation_id="conversation-1", continue_agent_session=False, session_generation=str(uuid4())
    )
    first = store.load_or_create_node_execution_session(scope, home_snapshot_id=None)
    snapshot = SessionSnapshot(layers={"history": {"current_round_step": 1}})
    store.save_active_snapshot(scope=scope, binding_id=first.binding_id, snapshot=snapshot)

    second = store.load_or_create_node_execution_session(
        replace(scope, node_execution_id=second_execution.id), home_snapshot_id=None
    )

    assert (second.workspace_id, second.binding_id, second.backend_binding_ref) == (
        first.workspace_id,
        first.binding_id,
        first.backend_binding_ref,
    )
    assert second.session_snapshot == snapshot
    assert len(allocations.requests) == 1


def test_reenabled_chatflow_generation_does_not_restore_legacy_history_or_workspace(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """Given an enabled node in a new generation, the prior generation stays isolated and intact."""
    first_execution = _execution_row()
    second_execution = _execution_row(execution_id="execution-2", workflow_run_id="run-2")
    sqlite_session.add_all([first_execution, second_execution])
    sqlite_session.commit()
    _record_workspace_allocations(monkeypatch)
    store = WorkflowAgentWorkspaceStore()
    original_scope = replace(_scope(), conversation_id="conversation-1")
    first = store.load_or_create_node_execution_session(original_scope, home_snapshot_id=None)
    original_snapshot = SessionSnapshot(layers={"history": {"old_session": "task A"}})
    store.save_active_snapshot(scope=original_scope, binding_id=first.binding_id, snapshot=original_snapshot)

    second = store.load_or_create_node_execution_session(
        replace(
            original_scope,
            workflow_run_id="run-2",
            node_execution_id=second_execution.id,
            session_generation=str(uuid4()),
        ),
        home_snapshot_id=None,
    )

    assert second.workspace_id != first.workspace_id
    assert second.binding_id != first.binding_id
    assert second.session_snapshot is None
    old_binding = sqlite_session.get(AgentWorkspaceBinding, first.binding_id)
    assert old_binding is not None
    assert old_binding.status is AgentWorkingResourceStatus.ACTIVE
    assert old_binding.session_snapshot is not None
    assert SessionSnapshot.model_validate_json(old_binding.session_snapshot) == original_snapshot


@pytest.mark.parametrize("continue_agent_session", [True, False])
@pytest.mark.parametrize("session_branch", ["", "a" * 64])
def test_chatflow_resume_and_sandbox_access_use_the_persisted_session_policy(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, continue_agent_session: bool, session_branch: str
) -> None:
    """Given a persisted participant, restore its policy and sandbox without allocating a replacement."""
    execution = _execution_row()
    sqlite_session.add_all(
        [
            execution,
            make_conversation(mode=AppMode.ADVANCED_CHAT, from_source=ConversationFromSource.CONSOLE),
            make_message(
                query="continue this task",
                message=[],
                answer="",
                from_source=ConversationFromSource.CONSOLE,
                workflow_run_id="run-1",
            ),
        ]
    )
    sqlite_session.commit()
    allocations = _record_workspace_allocations(monkeypatch)
    scope = replace(
        _scope(),
        conversation_id="conversation-1",
        continue_agent_session=continue_agent_session,
        session_generation=str(uuid4()),
        session_branch=session_branch,
    )
    store = WorkflowAgentWorkspaceStore()
    original = store.load_or_create_node_execution_session(scope, home_snapshot_id=None)
    snapshot = SessionSnapshot(layers={"history": {"paused": True}})
    store.save_active_snapshot(scope=scope, binding_id=original.binding_id, snapshot=snapshot)

    restored_scope = store.load_existing_node_execution_scope(
        tenant_id=scope.tenant_id,
        app_id=scope.app_id,
        workflow_id=scope.workflow_id,
        workflow_run_id=scope.workflow_run_id,
        node_id=scope.node_id,
        node_execution_id=scope.node_execution_id,
        conversation_id=scope.conversation_id,
    )

    assert restored_scope is not None
    assert restored_scope == scope
    restored = store.load_or_create_node_execution_session(restored_scope, home_snapshot_id=None)
    assert restored.binding_id == original.binding_id
    assert restored.session_snapshot == snapshot
    sqlite_session.expire_all()
    inspected = AgentSandboxRepository._resolve_workflow_binding(
        tenant_id=scope.tenant_id,
        app_id=scope.app_id,
        workflow_run_id="run-1",
        node_id=scope.node_id,
        node_execution_id=scope.node_execution_id,
        session=sqlite_session,
    )
    assert inspected.backend_binding_ref == original.backend_binding_ref
    assert len(allocations.requests) == 1
    with pytest.raises(AgentSandboxBindingNotFoundError):
        AgentSandboxRepository._resolve_workflow_binding(
            tenant_id=scope.tenant_id,
            app_id="different-app",
            workflow_run_id="run-1",
            node_id=scope.node_id,
            node_execution_id=scope.node_execution_id,
            session=sqlite_session,
        )


@pytest.mark.parametrize(
    "policy",
    [
        {"continue_agent_session": "false"},
        {"continue_agent_session": 0},
        {"continue_agent_session": None},
        {"agent_session_generation": 1},
        {"agent_session_generation": None},
        {"agent_session_generation": "invalid-uuid"},
        {"agent_session_generation": "ABCDEF01-2345-6789-ABCD-EF0123456789"},
        {"agent_session_branch": None},
        {"agent_session_branch": 1},
        {"agent_session_branch": "a" * 63},
        {"agent_session_branch": "a" * 65},
        {"agent_session_branch": "A" * 64},
        {"agent_session_branch": "z" * 64},
    ],
)
def test_resuming_chatflow_rejects_malformed_persisted_session_policy(
    sqlite_session: Session, policy: dict[str, object]
) -> None:
    """Given invalid persisted settings, fail before a participant can be read from an unintended scope."""
    execution = _execution_row(
        binding_id="binding-1", process_data={"workflow_agent_binding_id": "workflow-binding-1", **policy}
    )
    sqlite_session.add_all([execution, _workspace_row(), _binding_row()])
    sqlite_session.commit()

    with pytest.raises(AgentWorkspaceNotFoundError):
        WorkflowAgentWorkspaceStore().load_existing_node_execution_scope(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_run_id="run-1",
            node_id="node-1",
            node_execution_id="execution-1",
            conversation_id="conversation-1",
        )
    with pytest.raises(AgentSandboxBindingNotFoundError):
        AgentSandboxRepository._resolve_workflow_binding(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_run_id="run-1",
            node_id="node-1",
            node_execution_id="execution-1",
            session=sqlite_session,
        )


@pytest.mark.parametrize("changed_setting", ["enabled", "generation", "branch"])
def test_existing_chatflow_participant_rejects_changed_frozen_session_policy(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, changed_setting: str
) -> None:
    """Given an execution with a participant, conflicting policy cannot rebind or mutate it."""
    sqlite_session.add(_execution_row())
    sqlite_session.commit()
    allocations = _record_workspace_allocations(monkeypatch)
    store = WorkflowAgentWorkspaceStore()
    scope = replace(
        _scope(), conversation_id="conversation-1", continue_agent_session=False, session_generation=str(uuid4())
    )
    original = store.load_or_create_node_execution_session(scope, home_snapshot_id=None)
    if changed_setting == "enabled":
        changed_scope = replace(scope, continue_agent_session=True)
    elif changed_setting == "generation":
        changed_scope = replace(scope, session_generation=str(uuid4()))
    else:
        changed_scope = replace(scope, session_branch="b" * 64)

    with pytest.raises(AgentWorkspaceNotFoundError, match="session (policy|branch) does not match"):
        store.load_or_create_node_execution_session(changed_scope, home_snapshot_id=None)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(WorkflowNodeExecutionModel, scope.node_execution_id)
    assert persisted is not None
    assert persisted.agent_workspace_binding_id == original.binding_id
    assert persisted.process_data_dict is not None
    assert persisted.process_data_dict["continue_agent_session"] is False
    assert persisted.process_data_dict["agent_session_generation"] == scope.session_generation
    assert persisted.process_data_dict["agent_session_branch"] == scope.session_branch
    assert len(allocations.requests) == 1


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


@pytest.mark.parametrize("conversation_id", [None, "conversation-1"])
def test_workflow_tool_agent_workspace_identity_survives_resume(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, conversation_id: str | None
) -> None:
    execution = _execution_row()
    execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
    sqlite_session.add(execution)
    sqlite_session.commit()
    client = _install_backend_client(monkeypatch)
    scope = replace(_scope(), conversation_id=conversation_id, workflow_tool_invocation_id="tool-call-1")
    assert scope.workspace_owner.owner_type is AgentWorkspaceOwnerType.WORKFLOW_RUN
    assert scope.workspace_owner.owner_id == "run-1"
    stored = WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(scope, home_snapshot_id=None)
    snapshot = SessionSnapshot(layers={})
    WorkflowAgentWorkspaceStore().save_active_snapshot(
        scope=scope,
        binding_id=stored.binding_id,
        snapshot=snapshot,
    )

    resumed_store = WorkflowAgentWorkspaceStore()
    restored_scope = resumed_store.load_existing_node_execution_scope(
        tenant_id=scope.tenant_id,
        app_id=scope.app_id,
        workflow_id=scope.workflow_id,
        workflow_run_id=scope.workflow_run_id,
        node_id=scope.node_id,
        node_execution_id=scope.node_execution_id,
        conversation_id=conversation_id,
        workflow_tool_invocation_id="tool-call-1",
    )
    assert restored_scope is not None
    assert restored_scope == scope
    resumed = resumed_store.load_or_create_node_execution_session(restored_scope, home_snapshot_id=None)
    assert (resumed.workspace_id, resumed.binding_id) == (stored.workspace_id, stored.binding_id)
    assert resumed.session_snapshot == snapshot
    client.create_execution_binding_sync.assert_called_once()
    sqlite_session.expire_all()
    inspected = AgentSandboxRepository._resolve_workflow_binding(
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
        "continue_agent_session": True,
        "agent_session_generation": "",
        "agent_session_branch": "",
    }
    assert "agent_workspace_binding_id" not in persisted_execution.process_data_dict
    persisted_binding = sqlite_session.get(AgentWorkspaceBinding, stored.binding_id)
    assert persisted_binding is not None
    assert persisted_binding.base_home_snapshot_id == home_snapshot_id


def test_node_completion_preserves_workspace_binding_and_sandbox_access(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    scope = _scope()
    repository = SQLAlchemyWorkflowNodeExecutionRepository(
        sqlite_session_factory,
        scope.tenant_id,
        make_account(),
        scope.app_id,
        WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    execution = WorkflowNodeExecution(
        id=scope.node_execution_id,
        node_execution_id=scope.node_execution_id,
        workflow_id=scope.workflow_id,
        workflow_execution_id=scope.workflow_run_id,
        index=1,
        node_id=scope.node_id,
        node_type="agent",
        title="Agent",
        status=WorkflowNodeExecutionStatus.RUNNING,
        created_at=datetime(2026, 9, 23),
    )
    repository.save_synchronously(execution)
    _install_backend_client(monkeypatch)
    stored = WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(scope, home_snapshot_id=None)

    execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
    execution.outputs = {"result": "completed"}
    execution.process_data = {"result": "completed"}
    execution.elapsed_time = 1.0
    execution.finished_at = datetime(2026, 9, 23, 0, 0, 1)
    assert repository._to_db_model(execution).agent_workspace_binding_id is None
    repository.save(execution)

    with sqlite_session_factory() as session:
        persisted = session.get(WorkflowNodeExecutionModel, execution.id)
        assert persisted is not None
        assert persisted.agent_workspace_binding_id == stored.binding_id
        assert persisted.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert persisted.outputs_dict == {"result": "completed"}
        assert persisted.process_data_dict == {
            "result": "completed",
            "workflow_agent_binding_id": scope.workflow_agent_binding_id,
            "continue_agent_session": True,
            "agent_session_generation": "",
            "agent_session_branch": "",
        }
        assert persisted.elapsed_time == 1.0
        assert persisted.finished_at == execution.finished_at
        binding = AgentSandboxRepository._resolve_workflow_binding(
            tenant_id=scope.tenant_id,
            app_id=scope.app_id,
            workflow_run_id="run-1",
            node_id=scope.node_id,
            node_execution_id=scope.node_execution_id,
            session=session,
        )
        assert binding.backend_binding_ref == stored.backend_binding_ref


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
    original_process_data: dict[str, object] = {
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
    monkeypatch.setattr("core.workflow.nodes.agent_v2.session_store.sleep", sleep)

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
    sleep_count = 0

    def make_caller_visible(_seconds: float) -> None:
        nonlocal sleep_count
        sleep_count += 1
        if sleep_count == 2:
            with sqlite_session_factory() as observer:
                observer.add(_execution_row())
                observer.commit()

    monkeypatch.setattr("core.workflow.nodes.agent_v2.session_store.sleep", make_caller_visible)

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
    assert sleep_count == 2


def test_save_snapshot_targets_binding(sqlite_session: Session) -> None:
    binding = _binding_row()
    sqlite_session.add_all([_workspace_row(), binding])
    sqlite_session.commit()
    snapshot = SessionSnapshot(layers={})

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


def test_workflow_scope_creates_binding_without_existing_workspace_ref(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    execution = _execution_row(process_data={"workflow_agent_binding_id": "workflow-binding-1"})
    sqlite_session.add_all([_home_snapshot(), execution])
    sqlite_session.commit()
    client = _install_backend_client(monkeypatch)

    WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(_scope(), home_snapshot_id="home-1")

    request = client.create_execution_binding_sync.call_args.args[0]
    assert request.existing_workspace_ref is None


def test_conversation_scope_first_turn_creates_binding_without_existing_workspace_ref(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    execution = _execution_row(
        execution_id="execution-2",
        workflow_run_id="run-2",
        process_data={"workflow_agent_binding_id": "workflow-binding-1"},
    )
    sqlite_session.add_all([_home_snapshot(), execution])
    sqlite_session.commit()
    client = _install_backend_client(monkeypatch)

    scope = WorkflowAgentSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="run-2",
        node_id="node-1",
        node_execution_id="execution-2",
        workflow_agent_binding_id="workflow-binding-1",
        agent_id="agent-1",
        agent_config_snapshot_id="config-1",
        conversation_id="conversation-1",
    )
    WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(scope, home_snapshot_id="home-1")

    request = client.create_execution_binding_sync.call_args.args[0]
    assert request.existing_workspace_ref is None


@pytest.mark.parametrize("caller_app", ["app-1", "unrelated-app"])
@pytest.mark.parametrize("root_marker", [None, "app-1", "mismatched-app"])
@pytest.mark.parametrize("persist_run", [False, True])
def test_retire_workflow_tool_workspace_follows_persisted_run_owner(
    sqlite_session: Session, caller_app: str, root_marker: str | None, persist_run: bool
) -> None:
    run = WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=ModelWorkflowType(WorkflowType.WORKFLOW),
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
    execution = _execution_row(
        binding_id=binding.id,
        process_data={WORKFLOW_TOOL_ROOT_APP_ID_KEY: root_marker} if root_marker is not None else None,
    )
    execution.app_id = "source-app"
    execution.workflow_id = "source-workflow"
    execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
    unlinked_workspace = _workspace_row(
        workspace_id="unlinked-workspace", app_id="source-app", owner_scope_key="unlinked"
    )
    sqlite_session.add_all([workspace, binding, execution, unlinked_workspace])
    if persist_run:
        sqlite_session.add(run)
    sqlite_session.commit()

    result = WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id="tenant-1", app_id=caller_app, workflow_run_id=run.id
    )

    sqlite_session.expire_all()
    assert unlinked_workspace.status is AgentWorkingResourceStatus.ACTIVE
    if caller_app == "app-1" and (root_marker == "app-1" or (root_marker is None and persist_run)):
        assert result == [workspace.id]
        assert workspace.status is AgentWorkingResourceStatus.RETIRED
        assert binding.status is AgentWorkingResourceStatus.RETIRED
    else:
        assert result == []
        assert workspace.status is AgentWorkingResourceStatus.ACTIVE
        assert binding.status is AgentWorkingResourceStatus.ACTIVE


@pytest.mark.parametrize(
    "mismatch", ["caller-tenant", "caller-run", "caller-app", "binding-tenant", "binding-app", "origin"]
)
def test_retire_workflow_tool_workspace_checks_complete_caller_chain(sqlite_session: Session, mismatch: str) -> None:
    workspace = _workspace_row(app_id="source-app")
    binding = _binding_row()
    binding.app_id = "source-app"
    execution = _execution_row(binding_id=binding.id, process_data={WORKFLOW_TOOL_ROOT_APP_ID_KEY: "app-1"})
    execution.app_id = "source-app"
    execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
    if mismatch == "caller-tenant":
        execution.tenant_id = "other-tenant"
    elif mismatch == "caller-run":
        execution.workflow_run_id = "other-run"
    elif mismatch == "caller-app":
        execution.app_id = "other-app"
    elif mismatch == "binding-tenant":
        binding.tenant_id = "other-tenant"
    elif mismatch == "binding-app":
        binding.app_id = "other-app"
    else:
        execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    sqlite_session.add_all([workspace, binding, execution])
    sqlite_session.commit()

    assert (
        WorkflowAgentWorkspaceStore().retire_workflow_run(tenant_id="tenant-1", app_id="app-1", workflow_run_id="run-1")
        == []
    )
    sqlite_session.expire_all()
    assert workspace.status == AgentWorkingResourceStatus.ACTIVE
    assert binding.status == AgentWorkingResourceStatus.ACTIVE


@pytest.mark.parametrize("captured_owner", [False, True])
def test_deleting_paused_root_app_retires_and_deletes_nested_participants(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], captured_owner: bool
) -> None:
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Root",
        mode=AppMode.WORKFLOW,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#fff",
        enable_site=False,
        enable_api=False,
    )
    workspace = _workspace_row(app_id="source-app")
    binding = _binding_row()
    binding.app_id = "source-app"
    execution = _execution_row(
        binding_id=binding.id,
        process_data={WORKFLOW_TOOL_ROOT_APP_ID_KEY: "app-1"} if captured_owner else None,
    )
    execution.app_id = "source-app"
    execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
    execution.status = WorkflowNodeExecutionStatus.PAUSED
    unlinked = _workspace_row(workspace_id="unlinked", app_id="source-app", owner_scope_key="unlinked")
    sqlite_session.add_all([app, workspace, binding, execution, unlinked])
    if not captured_owner:
        sqlite_session.add(
            WorkflowRun(
                id="run-1",
                tenant_id="tenant-1",
                app_id="app-1",
                workflow_id="workflow-1",
                type=ModelWorkflowType(WorkflowType.WORKFLOW),
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                version="1",
                graph="{}",
                inputs="{}",
                status=WorkflowExecutionStatus.PAUSED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="user-1",
            )
        )
    sqlite_session.commit()

    with (
        patch("services.app_service.current_user", None),
        patch("services.app_service.app_was_deleted.send"),
        patch("services.app_service.remove_app_and_related_data_task.delay"),
        patch("services.app_service.WorkflowAgentRetirementService.retire_unowned"),
        patch("services.app_service.SystemFeatureService.is_webapp_auth_enabled", return_value=False),
        patch("services.app_service.enqueue_agent_resource_collection") as collect,
    ):
        AppService().delete_app(app, session=sqlite_session)

    sqlite_session.expire_all()
    assert workspace.status == AgentWorkingResourceStatus.RETIRED
    assert binding.status == AgentWorkingResourceStatus.RETIRED
    assert unlinked.status == AgentWorkingResourceStatus.ACTIVE
    assert collect.call_args.kwargs["workspace_ids"] == [workspace.id]
    assert (
        DifyAPISQLAlchemyWorkflowNodeExecutionRepository(sqlite_session_factory).delete_executions_by_app(
            "tenant-1", "app-1"
        )
        == 1
    )
    DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory).delete_runs_by_app("tenant-1", "app-1")
    sqlite_session.expire_all()
    assert sqlite_session.get(WorkflowNodeExecutionModel, "execution-1") is None
