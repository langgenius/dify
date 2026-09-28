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


def test_db_phase_failure_persists_nothing_and_publishes_nothing(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    """C5: an error before commit leaves zero persisted changes and zero publications, and propagates.

    The failure is injected at the last database step (home-snapshot retirement), after the
    agent archival and workspace/binding retirements have already been flushed in the
    service-owned session, so surviving partial writes would be visible here.
    """
    seeded = _seed_orphan_aggregate(sqlite_session)
    error = RuntimeError("retirement failed")
    monkeypatch.setattr(
        AgentHomeSnapshotService,
        "retire_all_for_agent",
        MagicMock(side_effect=error),
    )
    cleanup_app, collect = _celery_boundary_mocks(monkeypatch)

    with pytest.raises(RuntimeError) as exc_info:
        WorkflowAgentRetirementService.retire_unowned(
            tenant_id="tenant-1",
            agent_ids=[seeded.agent_id],
            account_id="account-1",
        )

    assert exc_info.value is error
    _assert_aggregate_untouched(sqlite_session, seeded)
    cleanup_app.assert_not_called()
    collect.assert_not_called()


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


def _seed_orphan_aggregate(
    session: Session,
    *,
    tenant_id: str = "tenant-1",
    suffix: str = "1",
    app_mode: AppMode = AppMode.AGENT,
    scope: AgentScope = AgentScope.WORKFLOW_ONLY,
) -> SimpleNamespace:
    """Seed one complete unowned Agent aggregate (agent + hidden App + home + workspace + binding)."""
    agent = Agent(
        id=f"agent-{suffix}",
        tenant_id=tenant_id,
        name=f"Inline Agent {suffix}",
        description="",
        role="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=scope,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
        backing_app_id=f"hidden-app-{suffix}",
    )
    app = App(
        id=f"hidden-app-{suffix}",
        tenant_id=tenant_id,
        name=f"Inline Agent runtime {suffix}",
        mode=app_mode,
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=True,
    )
    home = AgentHomeSnapshot(
        id=f"home-{suffix}",
        tenant_id=tenant_id,
        agent_id=agent.id,
        snapshot_ref=f"home-ref-{suffix}",
        status=AgentWorkingResourceStatus.ACTIVE,
    )
    workspace = AgentWorkspace(
        id=f"workspace-{suffix}",
        tenant_id=tenant_id,
        app_id=app.id,
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id=f"conversation-{suffix}",
        owner_scope_key="root",
        backend_workspace_ref=f"workspace-ref-{suffix}",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )
    binding = AgentWorkspaceBinding(
        id=f"binding-{suffix}",
        tenant_id=tenant_id,
        app_id=app.id,
        workspace_id=workspace.id,
        agent_id=agent.id,
        base_home_snapshot_id=home.id,
        agent_config_version_id=f"config-{suffix}",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref=f"binding-ref-{suffix}",
        status=AgentWorkingResourceStatus.ACTIVE,
    )
    session.add_all([agent, app, home, workspace, binding])
    session.commit()
    # Return plain ids: the service commits (and may delete rows) in its own session,
    # so holding ORM instances here would raise on refresh after expire_all().
    return SimpleNamespace(
        agent_id=agent.id,
        app_id=app.id,
        home_id=home.id,
        workspace_id=workspace.id,
        binding_id=binding.id,
    )


def _publication_mocks(monkeypatch: pytest.MonkeyPatch) -> tuple[MagicMock, MagicMock]:
    cleanup_app = MagicMock()
    enqueue_collection = MagicMock()
    monkeypatch.setattr(
        "services.agent.retirement_service.remove_app_and_related_data_task.delay",
        cleanup_app,
    )
    monkeypatch.setattr(
        "services.agent.retirement_service.enqueue_agent_resource_collection",
        enqueue_collection,
    )
    return cleanup_app, enqueue_collection


def _celery_boundary_mocks(monkeypatch: pytest.MonkeyPatch) -> tuple[MagicMock, MagicMock]:
    """Mock the actual celery publication boundaries (enqueue_agent_resource_collection
    itself short-circuits on an all-empty payload, so 'zero publications' is observed here)."""
    cleanup_app = MagicMock()
    collect = MagicMock()
    monkeypatch.setattr(
        "services.agent.retirement_service.remove_app_and_related_data_task.delay",
        cleanup_app,
    )
    monkeypatch.setattr(
        "tasks.collect_agent_resources_task.collect_agent_resources.delay",
        collect,
    )
    return cleanup_app, collect


def _assert_aggregate_untouched(session: Session, seeded: SimpleNamespace) -> None:
    session.expire_all()
    agent = session.get(Agent, seeded.agent_id)
    assert agent is not None
    assert agent.status is AgentStatus.ACTIVE
    assert agent.archived_by is None
    assert session.get(App, seeded.app_id) is not None
    assert session.get(AgentWorkspace, seeded.workspace_id).status is AgentWorkingResourceStatus.ACTIVE
    assert session.get(AgentWorkspaceBinding, seeded.binding_id).status is AgentWorkingResourceStatus.ACTIVE
    assert session.get(AgentHomeSnapshot, seeded.home_id).status is AgentWorkingResourceStatus.ACTIVE


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


def test_hidden_app_cleanup_failure_blocks_collector_and_keeps_committed_state(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    """C6: every hidden-App cleanup publishes before the collector; a cleanup failure blocks
    the collector and propagates, while the already-committed database state is kept."""
    first = _seed_orphan_aggregate(sqlite_session, suffix="1")
    second = _seed_orphan_aggregate(sqlite_session, suffix="2")
    error = RuntimeError("broker unavailable")
    cleanup_app, enqueue_collection = _publication_mocks(monkeypatch)
    cleanup_app.side_effect = [None, error]

    with pytest.raises(RuntimeError) as exc_info:
        WorkflowAgentRetirementService.retire_unowned(
            tenant_id="tenant-1",
            agent_ids=[first.agent_id, second.agent_id],
            account_id="account-1",
        )

    assert exc_info.value is error
    assert [call.kwargs["app_id"] for call in cleanup_app.call_args_list] == ["hidden-app-1", "hidden-app-2"]
    enqueue_collection.assert_not_called()
    sqlite_session.expire_all()
    for seeded in (first, second):
        assert sqlite_session.get(Agent, seeded.agent_id).status is AgentStatus.ARCHIVED
        assert sqlite_session.get(App, seeded.app_id) is None


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


def test_roster_scoped_agent_is_never_touched(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    """C3: an agent outside WORKFLOW_ONLY scope is never modified, even when passed in and unowned."""
    seeded = _seed_orphan_aggregate(sqlite_session, scope=AgentScope.ROSTER)
    cleanup_app, collect = _celery_boundary_mocks(monkeypatch)

    WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[seeded.agent_id],
        account_id="account-1",
    )

    _assert_aggregate_untouched(sqlite_session, seeded)
    cleanup_app.assert_not_called()
    collect.assert_not_called()


def test_non_agent_mode_backing_app_is_never_deleted(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    """C3: hidden-App deletion is guarded on mode == AGENT; a backing app of any other mode survives."""
    seeded = _seed_orphan_aggregate(sqlite_session, app_mode=AppMode.CHAT)
    _publication_mocks(monkeypatch)

    WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[seeded.agent_id],
        account_id="account-1",
    )

    sqlite_session.expire_all()
    assert sqlite_session.get(Agent, seeded.agent_id).status is AgentStatus.ARCHIVED
    stored_app = sqlite_session.get(App, seeded.app_id)
    assert stored_app is not None
    assert stored_app.mode == AppMode.CHAT


def test_tenant_isolation_leaves_other_tenant_rows_untouched(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    """C4: retirement for tenant A never touches tenant B rows that share the same
    non-key column values (same app_id on a workspace, same agent_id on a binding
    and a home snapshot), and they never appear in the collector payload."""
    target = _seed_orphan_aggregate(sqlite_session)
    decoy_workspace = AgentWorkspace(
        id="workspace-b",
        tenant_id="tenant-2",
        app_id=target.app_id,
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation-b",
        owner_scope_key="root",
        backend_workspace_ref="workspace-ref-b",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )
    decoy_binding = AgentWorkspaceBinding(
        id="binding-b",
        tenant_id="tenant-2",
        app_id=target.app_id,
        workspace_id=decoy_workspace.id,
        agent_id=target.agent_id,
        base_home_snapshot_id="home-b",
        agent_config_version_id="config-b",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="binding-ref-b",
        status=AgentWorkingResourceStatus.ACTIVE,
    )
    decoy_home = AgentHomeSnapshot(
        id="home-b",
        tenant_id="tenant-2",
        agent_id=target.agent_id,
        snapshot_ref="home-ref-b",
        status=AgentWorkingResourceStatus.ACTIVE,
    )
    sqlite_session.add_all([decoy_workspace, decoy_binding, decoy_home])
    sqlite_session.commit()
    cleanup_app, enqueue_collection = _publication_mocks(monkeypatch)

    WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[target.agent_id],
        account_id="account-1",
    )

    sqlite_session.expire_all()
    assert sqlite_session.get(Agent, target.agent_id).status is AgentStatus.ARCHIVED
    assert sqlite_session.get(AgentWorkspace, "workspace-b").status is AgentWorkingResourceStatus.ACTIVE
    assert sqlite_session.get(AgentWorkspaceBinding, "binding-b").status is AgentWorkingResourceStatus.ACTIVE
    assert sqlite_session.get(AgentHomeSnapshot, "home-b").status is AgentWorkingResourceStatus.ACTIVE
    cleanup_app.assert_called_once_with(tenant_id="tenant-1", app_id=target.app_id)
    enqueue_collection.assert_called_once_with(
        tenant_id="tenant-1",
        workspace_ids=[target.workspace_id],
        binding_ids=[target.binding_id],
        home_snapshot_ids=[target.home_id],
        purge_agent_ids=[target.agent_id],
    )


def test_repeat_after_success_republishes_full_payload_and_preserves_audit(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    """C7: rerunning after a fully successful run republishes the complete cleanup and
    collector payloads (duplicate delivery is allowed; consumers are idempotent), and the
    first archival's audit fields are not overwritten."""
    seeded = _seed_orphan_aggregate(sqlite_session)
    cleanup_app, enqueue_collection = _publication_mocks(monkeypatch)

    WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[seeded.agent_id],
        account_id="account-1",
    )
    sqlite_session.expire_all()
    stored_agent = sqlite_session.get(Agent, seeded.agent_id)
    assert stored_agent.status is AgentStatus.ARCHIVED
    assert stored_agent.archived_by == "account-1"
    first_archived_at = stored_agent.archived_at

    WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[seeded.agent_id],
        account_id="account-2",
    )

    assert cleanup_app.call_count == 2
    assert all(call.kwargs == {"tenant_id": "tenant-1", "app_id": seeded.app_id} for call in cleanup_app.call_args_list)
    assert enqueue_collection.call_count == 2
    assert enqueue_collection.call_args_list[0] == enqueue_collection.call_args_list[1]
    assert enqueue_collection.call_args.kwargs == {
        "tenant_id": "tenant-1",
        "workspace_ids": [seeded.workspace_id],
        "binding_ids": [seeded.binding_id],
        "home_snapshot_ids": [seeded.home_id],
        "purge_agent_ids": [seeded.agent_id],
    }
    sqlite_session.expire_all()
    stored_agent = sqlite_session.get(Agent, seeded.agent_id)
    assert stored_agent.archived_by == "account-1"
    assert stored_agent.archived_at == first_archived_at


@pytest.mark.parametrize("candidates", [[], ["", ""]], ids=["empty", "all-blank"])
def test_blank_candidates_cause_no_side_effects(
    monkeypatch: pytest.MonkeyPatch,
    candidates: list[str],
) -> None:
    """C8: empty or all-blank candidate lists open no transaction and publish nothing."""
    create_session = MagicMock()
    monkeypatch.setattr(
        "services.agent.retirement_service.session_factory.create_session",
        create_session,
    )
    cleanup_app, enqueue_collection = _publication_mocks(monkeypatch)

    WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=candidates,
        account_id="account-1",
    )

    create_session.assert_not_called()
    cleanup_app.assert_not_called()
    enqueue_collection.assert_not_called()


def test_duplicate_candidate_ids_are_processed_once(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    """C8: duplicate candidate ids collapse to one processing pass and one payload entry each."""
    seeded = _seed_orphan_aggregate(sqlite_session)
    cleanup_app, enqueue_collection = _publication_mocks(monkeypatch)

    WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[seeded.agent_id, seeded.agent_id, seeded.agent_id],
        account_id="account-1",
    )

    cleanup_app.assert_called_once_with(tenant_id="tenant-1", app_id=seeded.app_id)
    enqueue_collection.assert_called_once_with(
        tenant_id="tenant-1",
        workspace_ids=[seeded.workspace_id],
        binding_ids=[seeded.binding_id],
        home_snapshot_ids=[seeded.home_id],
        purge_agent_ids=[seeded.agent_id],
    )


def test_non_candidate_same_tenant_aggregate_is_untouched(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    """C9: a same-tenant orphan that is not in the candidate list keeps its entire aggregate
    active and stays out of every publication payload."""
    target = _seed_orphan_aggregate(sqlite_session, suffix="1")
    bystander = _seed_orphan_aggregate(sqlite_session, suffix="2")
    cleanup_app, enqueue_collection = _publication_mocks(monkeypatch)

    WorkflowAgentRetirementService.retire_unowned(
        tenant_id="tenant-1",
        agent_ids=[target.agent_id],
        account_id="account-1",
    )

    sqlite_session.expire_all()
    assert sqlite_session.get(Agent, target.agent_id).status is AgentStatus.ARCHIVED
    _assert_aggregate_untouched(sqlite_session, bystander)
    cleanup_app.assert_called_once_with(tenant_id="tenant-1", app_id=target.app_id)
    enqueue_collection.assert_called_once_with(
        tenant_id="tenant-1",
        workspace_ids=[target.workspace_id],
        binding_ids=[target.binding_id],
        home_snapshot_ids=[target.home_id],
        purge_agent_ids=[target.agent_id],
    )
