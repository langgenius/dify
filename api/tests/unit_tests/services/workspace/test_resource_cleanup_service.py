from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from models import Dataset
from models.agent import Agent, AgentHomeSnapshot, AgentScope, AgentSource, AgentStatus, AgentWorkingResourceStatus
from services.workspace import resource_cleanup_service as module


def test_agent_sweep_covers_all_scopes_and_retains_other_tenants(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    agents = [
        Agent(
            id="roster",
            tenant_id="target",
            name="Roster",
            scope=AgentScope.ROSTER,
            source=AgentSource.WORKFLOW,
            backing_app_id="missing-app",
        ),
        Agent(
            id="inline", tenant_id="target", name="Inline", scope=AgentScope.WORKFLOW_ONLY, source=AgentSource.WORKFLOW
        ),
        Agent(
            id="archived",
            tenant_id="target",
            name="Archived",
            scope=AgentScope.ROSTER,
            source=AgentSource.WORKFLOW,
            status=AgentStatus.ARCHIVED,
        ),
        Agent(id="other", tenant_id="other-tenant", name="Other", scope=AgentScope.ROSTER, source=AgentSource.WORKFLOW),
    ]
    snapshot = AgentHomeSnapshot(id="home", tenant_id="target", agent_id="inline", snapshot_ref="backend-home")
    sqlite_session.add_all([*agents, snapshot])
    sqlite_session.commit()
    collection = Mock()
    app_cleanup = Mock()
    monkeypatch.setattr(module, "enqueue_agent_resource_collection", collection)
    monkeypatch.setattr(module, "remove_app_and_related_data_task", app_cleanup)

    def assert_committed(**_kwargs: object) -> None:
        sqlite_session.expire_all()
        inline_agent = sqlite_session.get(Agent, "inline")
        assert inline_agent is not None
        assert inline_agent.status == AgentStatus.ARCHIVED
        home_snapshot = sqlite_session.get(AgentHomeSnapshot, "home")
        assert home_snapshot is not None
        assert home_snapshot.status == AgentWorkingResourceStatus.RETIRED

    collection.side_effect = assert_committed
    module.WorkspaceResourceCleanupService._retire_agents("target")
    payload = collection.call_args.kwargs
    assert set(payload["purge_agent_ids"]) == {"roster", "inline", "archived"}
    assert payload["home_snapshot_ids"] == ["home"]
    other_agent = sqlite_session.get(Agent, "other")
    assert other_agent is not None
    assert other_agent.status == AgentStatus.ACTIVE
    app_cleanup.delay.assert_called_once_with(tenant_id="target", app_id="missing-app")


def test_dataset_deletion_schedules_even_without_index_configuration(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    sqlite_session.add_all(
        [
            Dataset(id="dataset", tenant_id="target", name="Empty", created_by="owner"),
            Dataset(id="other-dataset", tenant_id="other", name="Other", created_by="owner"),
        ]
    )
    sqlite_session.commit()
    cleanup = Mock()
    monkeypatch.setattr(module, "clean_dataset_task", cleanup)
    monkeypatch.setattr(module.dataset_api_key_bindings, "delete_keys_scoped_only_to", Mock())
    monkeypatch.setattr(module, "build_resource_access_token_cleanup_service", Mock())
    module.WorkspaceResourceCleanupService._delete_dataset("target", "other-dataset")
    cleanup.delay.assert_not_called()
    module.WorkspaceResourceCleanupService._delete_dataset("target", "dataset")
    cleanup.delay.assert_called_once()
    assert cleanup.delay.call_args.args[:2] == ("dataset", "target")
    sqlite_session.expire_all()
    assert sqlite_session.get(Dataset, "dataset") is None
    assert sqlite_session.get(Dataset, "other-dataset") is not None


def test_agent_collection_failure_propagates_and_retirement_can_be_retried(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    sqlite_session.add(
        Agent(id="agent", tenant_id="target", name="Agent", scope=AgentScope.ROSTER, source=AgentSource.WORKFLOW)
    )
    sqlite_session.commit()
    collection = Mock(side_effect=RuntimeError("broker unavailable"))
    monkeypatch.setattr(module, "enqueue_agent_resource_collection", collection)
    with pytest.raises(RuntimeError, match="broker unavailable"):
        module.WorkspaceResourceCleanupService._retire_agents("target")
    collection.side_effect = None
    module.WorkspaceResourceCleanupService._retire_agents("target")
    assert collection.call_args.kwargs["purge_agent_ids"] == ["agent"]


def test_working_resources_are_retired_even_when_the_app_is_missing(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from models.agent import (
        AgentConfigVersionKind,
        AgentWorkspace,
        AgentWorkspaceBinding,
        AgentWorkspaceOwnerType,
    )

    workspace = AgentWorkspace(
        id="working",
        tenant_id="target",
        app_id="missing-app",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation",
        owner_scope_key="conversation",
        backend_workspace_ref="backend-workspace",
    )
    binding = AgentWorkspaceBinding(
        id="binding",
        tenant_id="target",
        app_id="missing-app",
        workspace_id="working",
        agent_id="missing-agent",
        agent_config_version_id="config",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="backend-binding",
    )
    sqlite_session.add_all([workspace, binding])
    sqlite_session.commit()
    collection = Mock()
    monkeypatch.setattr(module, "enqueue_agent_resource_collection", collection)
    module.WorkspaceResourceCleanupService._retire_agents("target")
    sqlite_session.expire_all()
    working_workspace = sqlite_session.get(AgentWorkspace, "working")
    assert working_workspace is not None
    assert working_workspace.status == AgentWorkingResourceStatus.RETIRED
    working_binding = sqlite_session.get(AgentWorkspaceBinding, "binding")
    assert working_binding is not None
    assert working_binding.status == AgentWorkingResourceStatus.RETIRED
    assert collection.call_args.kwargs["workspace_ids"] == ["working"]
    assert collection.call_args.kwargs["binding_ids"] == ["binding"]


def test_resource_failure_does_not_skip_the_other_groups(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from models import App
    from models.enums import AppStatus
    from models.model import AppMode

    sqlite_session.add_all(
        [
            App(
                id="app",
                tenant_id="target",
                name="App",
                mode=AppMode.WORKFLOW,
                status=AppStatus.NORMAL,
                enable_site=True,
                enable_api=True,
            ),
            Dataset(id="dataset", tenant_id="target", name="Dataset", created_by="owner"),
        ]
    )
    sqlite_session.commit()
    app_service = Mock()
    app_service.return_value.delete_app.side_effect = RuntimeError("app failed")
    monkeypatch.setattr(module, "AppService", app_service)
    datasets = Mock()
    agents = Mock()
    monkeypatch.setattr(module.WorkspaceResourceCleanupService, "_delete_dataset", datasets)
    monkeypatch.setattr(module.WorkspaceResourceCleanupService, "_retire_agents", agents)
    with pytest.raises(RuntimeError, match="app:app"):
        module.WorkspaceResourceCleanupService.cleanup("target")
    datasets.assert_called_once_with("target", "dataset")
    agents.assert_called_once_with("target")


def test_agent_skill_snapshots_and_orphan_homes_are_included(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from models.skill import AgentSkillBindingSnapshot

    sqlite_session.add_all(
        [
            AgentHomeSnapshot(id="orphan-home", tenant_id="target", agent_id="missing", snapshot_ref="backend"),
            AgentSkillBindingSnapshot(
                id="target-binding",
                tenant_id="target",
                agent_id="missing",
                config_snapshot_id="config",
                skill_id="skill",
                priority=0,
            ),
            AgentSkillBindingSnapshot(
                id="other-binding",
                tenant_id="other",
                agent_id="missing",
                config_snapshot_id="config",
                skill_id="skill",
                priority=0,
            ),
        ]
    )
    sqlite_session.commit()
    collection = Mock()
    monkeypatch.setattr(module, "enqueue_agent_resource_collection", collection)
    module.WorkspaceResourceCleanupService._retire_agents("target")
    sqlite_session.expire_all()
    assert sqlite_session.get(AgentSkillBindingSnapshot, "target-binding") is None
    assert sqlite_session.get(AgentSkillBindingSnapshot, "other-binding") is not None
    orphan_home = sqlite_session.get(AgentHomeSnapshot, "orphan-home")
    assert orphan_home is not None
    assert orphan_home.status == AgentWorkingResourceStatus.RETIRED
    assert collection.call_args.kwargs["home_snapshot_ids"] == ["orphan-home"]


def test_direct_cleanup_does_not_resolve_a_console_login(
    app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from unittest.mock import MagicMock

    from models import App
    from models.enums import AppStatus
    from models.model import AppMode
    from services import app_service

    sqlite_session.add(
        App(
            id="app",
            tenant_id="target",
            name="App",
            mode=AppMode.WORKFLOW,
            status=AppStatus.NORMAL,
            enable_site=True,
            enable_api=True,
        )
    )
    sqlite_session.commit()
    user = MagicMock()
    user.__bool__.side_effect = AssertionError("inner API must not load a console user")
    monkeypatch.setattr(app_service, "current_user", user)
    monkeypatch.setattr(app_service.app_was_deleted, "send", Mock())
    monkeypatch.setattr(app_service, "build_resource_access_token_cleanup_service", Mock())
    monkeypatch.setattr(app_service, "remove_app_and_related_data_task", Mock())
    retirement = Mock()
    monkeypatch.setattr(app_service, "WorkflowAgentRetirementService", retirement)
    monkeypatch.setattr(app_service, "enqueue_agent_resource_collection", Mock())
    features = Mock()
    features.is_webapp_auth_enabled.return_value = False
    monkeypatch.setattr(app_service, "SystemFeatureService", features)
    monkeypatch.setattr(app_service, "BillingService", Mock())
    monkeypatch.setattr(module, "enqueue_agent_resource_collection", Mock())
    with app.test_request_context(method="DELETE"):
        module.WorkspaceResourceCleanupService.cleanup("target")
    sqlite_session.expire_all()
    assert sqlite_session.get(App, "app") is None
    assert retirement.retire_unowned.call_args.kwargs["account_id"] is None
    user.__bool__.assert_not_called()
