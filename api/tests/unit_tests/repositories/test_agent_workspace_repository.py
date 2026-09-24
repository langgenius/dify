from dataclasses import replace
from datetime import datetime
from typing import Literal

import pytest
from sqlalchemy.orm import Session

from core.agent.workspace import WorkspaceOwnerScope
from models.agent import (
    AgentConfigVersionKind,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from repositories.agent_workspace_repository import AgentWorkspaceRepository

_SCOPE = WorkspaceOwnerScope(
    tenant_id="tenant-1",
    app_id="app-1",
    owner_type=AgentWorkspaceOwnerType.CONVERSATION,
    owner_id="conversation-1",
)
_RETIRED_AT = datetime(2026, 9, 1)


def _workspace(workspace_id: str, scope: WorkspaceOwnerScope) -> AgentWorkspace:
    return AgentWorkspace(
        id=workspace_id,
        tenant_id=scope.tenant_id,
        app_id=scope.app_id,
        owner_type=scope.owner_type,
        owner_id=scope.owner_id,
        owner_scope_key=scope.owner_scope_key,
        backend_workspace_ref=f"{workspace_id}-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )


def _binding(binding_id: str, workspace: AgentWorkspace) -> AgentWorkspaceBinding:
    return AgentWorkspaceBinding(
        id=binding_id,
        tenant_id=workspace.tenant_id,
        app_id=workspace.app_id,
        workspace_id=workspace.id,
        agent_id="agent-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref=f"{binding_id}-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
    )


@pytest.fixture
def workspace_binding(sqlite_session: Session) -> tuple[AgentWorkspace, AgentWorkspaceBinding]:
    workspace = _workspace("workspace-1", _SCOPE)
    binding = _binding("binding-1", workspace)
    sqlite_session.add_all([workspace, binding])
    sqlite_session.commit()
    return workspace, binding


@pytest.mark.parametrize(
    "scope",
    [
        _SCOPE,
        replace(_SCOPE, tenant_id="other-tenant"),
        replace(_SCOPE, app_id="other-app"),
        replace(_SCOPE, owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT),
        replace(_SCOPE, owner_id="other-conversation"),
        replace(_SCOPE, owner_scope_key="node-1:binding-1"),
    ],
    ids=["matching", "tenant", "app", "owner-type", "owner-id", "owner-scope-key"],
)
def test_get_active_binding_requires_complete_owner_scope(
    sqlite_session: Session,
    workspace_binding: tuple[AgentWorkspace, AgentWorkspaceBinding],
    scope: WorkspaceOwnerScope,
) -> None:
    _workspace_row, binding = workspace_binding
    resolved = AgentWorkspaceRepository(session=sqlite_session).get_active_binding(
        tenant_id=_SCOPE.tenant_id,
        binding_id=binding.id,
        expected_owner_scope=scope,
    )

    assert resolved is (binding if scope == _SCOPE else None)


@pytest.mark.parametrize(
    ("tenant_id", "binding_id"),
    [("other-tenant", "binding-1"), ("tenant-1", "missing-binding")],
)
@pytest.mark.usefixtures("workspace_binding")
def test_get_active_binding_requires_requested_tenant_and_binding(
    sqlite_session: Session,
    tenant_id: str,
    binding_id: str,
) -> None:
    assert (
        AgentWorkspaceRepository(session=sqlite_session).get_active_binding(
            tenant_id=tenant_id,
            binding_id=binding_id,
            expected_owner_scope=_SCOPE,
        )
        is None
    )


@pytest.mark.parametrize("mismatch", ["binding-tenant", "workspace-id", "retired-binding", "retired-workspace"])
def test_get_active_binding_requires_active_binding_joined_to_its_active_workspace(
    sqlite_session: Session,
    workspace_binding: tuple[AgentWorkspace, AgentWorkspaceBinding],
    mismatch: str,
) -> None:
    workspace, binding = workspace_binding
    if mismatch == "binding-tenant":
        binding.tenant_id = "other-tenant"
    elif mismatch == "workspace-id":
        binding.workspace_id = "missing-workspace"
    elif mismatch == "retired-binding":
        binding.status = AgentWorkingResourceStatus.RETIRED
    else:
        workspace.status = AgentWorkingResourceStatus.RETIRED
    sqlite_session.commit()

    assert (
        AgentWorkspaceRepository(session=sqlite_session).get_active_binding(
            tenant_id=binding.tenant_id,
            binding_id=binding.id,
            expected_owner_scope=_SCOPE,
        )
        is None
    )


def test_retire_all_for_conversation_scopes_workspaces_and_active_bindings(sqlite_session: Session) -> None:
    matching = [
        _workspace("root", _SCOPE),
        _workspace("node", replace(_SCOPE, owner_scope_key="node-1:binding-1")),
    ]
    excluded = [
        _workspace("other-tenant", replace(_SCOPE, tenant_id="other-tenant")),
        _workspace("other-app", replace(_SCOPE, app_id="other-app", owner_scope_key="other-app")),
        _workspace("other-conversation", replace(_SCOPE, owner_id="other-conversation")),
        _workspace("workflow-run", replace(_SCOPE, owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN)),
        _workspace("already-retired", replace(_SCOPE, owner_scope_key="already-retired")),
    ]
    active_bindings = [_binding(f"{workspace.id}-binding", workspace) for workspace in matching]
    active_bindings.append(_binding("second-root-binding", matching[0]))
    excluded_bindings = [_binding(f"{workspace.id}-binding", workspace) for workspace in excluded]
    foreign_binding = _binding("foreign-binding", matching[0])
    foreign_binding.tenant_id = "other-tenant"
    retired_binding = _binding("retired-root-binding", matching[0])
    sqlite_session.add_all(
        [*matching, *excluded, *active_bindings, *excluded_bindings, foreign_binding, retired_binding]
    )
    sqlite_session.flush()
    excluded[-1].status = AgentWorkingResourceStatus.RETIRED
    excluded[-1].active_guard = None
    excluded[-1].retired_at = _RETIRED_AT
    retired_binding.status = AgentWorkingResourceStatus.RETIRED
    retired_binding.retired_at = _RETIRED_AT
    sqlite_session.commit()
    repository = AgentWorkspaceRepository(session=sqlite_session)

    retired_ids = repository.retire_all_for_conversation(
        tenant_id=_SCOPE.tenant_id,
        app_id=_SCOPE.app_id,
        conversation_id=_SCOPE.owner_id,
    )
    sqlite_session.commit()
    sqlite_session.expire_all()

    assert set(retired_ids) == {workspace.id for workspace in matching}
    for workspace in matching:
        assert workspace.status is AgentWorkingResourceStatus.RETIRED
        assert workspace.active_guard is None
        assert workspace.retired_at is not None
    for binding in active_bindings:
        assert binding.status is AgentWorkingResourceStatus.RETIRED
        workspace = next(workspace for workspace in matching if workspace.id == binding.workspace_id)
        assert binding.retired_at == workspace.retired_at
    for workspace in excluded[:-1]:
        assert workspace.status is AgentWorkingResourceStatus.ACTIVE
        assert workspace.active_guard == 1
        assert workspace.retired_at is None
    for binding in [*excluded_bindings, foreign_binding]:
        assert binding.status is AgentWorkingResourceStatus.ACTIVE
        assert binding.retired_at is None
    assert excluded[-1].retired_at == _RETIRED_AT
    assert retired_binding.retired_at == _RETIRED_AT
    assert (
        repository.retire_all_for_conversation(
            tenant_id=_SCOPE.tenant_id,
            app_id=_SCOPE.app_id,
            conversation_id=_SCOPE.owner_id,
        )
        == []
    )


@pytest.mark.parametrize("operation", ["workspace", "conversation"])
def test_caller_rollback_restores_workspace_and_bindings(
    sqlite_session: Session,
    workspace_binding: tuple[AgentWorkspace, AgentWorkspaceBinding],
    operation: Literal["workspace", "conversation"],
) -> None:
    workspace, binding = workspace_binding
    workspace_id, binding_id = workspace.id, binding.id
    repository = AgentWorkspaceRepository(session=sqlite_session)
    with sqlite_session.begin() as transaction:
        if operation == "workspace":
            assert repository.retire_workspace(tenant_id=_SCOPE.tenant_id, workspace_id=workspace.id) == workspace.id
        else:
            assert repository.retire_all_for_conversation(
                tenant_id=_SCOPE.tenant_id,
                app_id=_SCOPE.app_id,
                conversation_id=_SCOPE.owner_id,
            ) == [workspace.id]
        sqlite_session.flush()
        assert workspace.status is AgentWorkingResourceStatus.RETIRED
        assert workspace.active_guard is None
        assert binding.status is AgentWorkingResourceStatus.RETIRED
        assert binding.retired_at == workspace.retired_at
        transaction.rollback()

    stored_workspace = sqlite_session.get(AgentWorkspace, workspace_id)
    stored_binding = sqlite_session.get(AgentWorkspaceBinding, binding_id)
    assert stored_workspace is not None
    assert stored_binding is not None
    assert stored_workspace.status is AgentWorkingResourceStatus.ACTIVE
    assert stored_workspace.active_guard == 1
    assert stored_workspace.retired_at is None
    assert stored_binding.status is AgentWorkingResourceStatus.ACTIVE
    assert stored_binding.retired_at is None


@pytest.mark.parametrize("tenant_id", ["tenant-1", "other-tenant"])
def test_retire_workspace_ignores_missing_or_foreign_workspace(
    sqlite_session: Session,
    workspace_binding: tuple[AgentWorkspace, AgentWorkspaceBinding],
    tenant_id: str,
) -> None:
    workspace, binding = workspace_binding
    workspace_id = "missing-workspace" if tenant_id == _SCOPE.tenant_id else workspace.id

    assert (
        AgentWorkspaceRepository(session=sqlite_session).retire_workspace(
            tenant_id=tenant_id, workspace_id=workspace_id
        )
        is None
    )
    assert workspace.status is AgentWorkingResourceStatus.ACTIVE
    assert binding.status is AgentWorkingResourceStatus.ACTIVE
