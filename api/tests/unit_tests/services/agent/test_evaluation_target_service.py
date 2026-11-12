import pytest
from sqlalchemy.orm import Session

from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentScope,
    AgentSource,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import AppMode
from services.agent.evaluation_target_service import AgentEvaluationTargetService, ResolvedAgentEvaluationTarget
from services.agent.workspace_service import AgentWorkspaceService, WorkspaceOwnerScope
from tests.helpers.unit.model_factories import make_app


def _agent_soul_snapshot() -> dict[str, object]:
    return {
        "model": {
            "plugin_id": "langgenius/openai",
            "model_provider": "langgenius/openai/openai",
            "model": "gpt-4o-mini",
        }
    }


def test_resolve_active_snapshot_requires_a_published_agent(sqlite_session: Session) -> None:
    """An App-backed Agent without a publish-visible revision cannot start a new evaluation."""
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Research Agent",
        app_id="app-1",
        active_config_snapshot_id="snapshot-1",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
    )
    sqlite_session.add(agent)
    sqlite_session.flush()

    with pytest.raises(ValueError, match="published configuration"):
        AgentEvaluationTargetService.resolve_active_snapshot(
            session=sqlite_session,
            tenant_id="tenant-1",
            agent_id="agent-1",
        )


def test_resolve_pinned_snapshot_does_not_follow_a_later_publication(sqlite_session: Session) -> None:
    """A worker retry resolves its pinned snapshot even when the Agent's active ID changed."""
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Research Agent",
        app_id="app-1",
        active_config_snapshot_id="snapshot-new",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
    )
    pinned_snapshot = AgentConfigSnapshot(
        id="snapshot-old",
        tenant_id="tenant-1",
        agent_id=agent.id,
        version=1,
        home_snapshot_id="home-old",
        config_snapshot=_agent_soul_snapshot(),
    )
    newer_snapshot = AgentConfigSnapshot(
        id="snapshot-new",
        tenant_id="tenant-1",
        agent_id=agent.id,
        version=2,
        config_snapshot=_agent_soul_snapshot(),
    )
    app = make_app(app_id="app-1", tenant_id="tenant-1", mode=AppMode.AGENT)
    sqlite_session.add_all([agent, pinned_snapshot, newer_snapshot, app])
    sqlite_session.flush()

    resolved = AgentEvaluationTargetService.resolve_active_snapshot(
        session=sqlite_session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        snapshot_id="snapshot-old",
    )

    assert resolved.config_snapshot_id == "snapshot-old"
    assert resolved.home_snapshot_id == "home-old"
    assert resolved.agent_soul.model is not None
    assert resolved.app_id == app.id


@pytest.mark.parametrize("binding_state", ["matching", "wrong_agent", "missing", "new"])
def test_ensure_row_binding_reuses_only_a_matching_active_generation(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, binding_state: str
) -> None:
    target = ResolvedAgentEvaluationTarget(
        agent_id="agent-1",
        agent_name="Research Agent",
        app_id="app-1",
        config_snapshot_id="snapshot-1",
        home_snapshot_id="home-1",
        agent_soul=AgentSoulConfig(),
    )
    existing = AgentWorkspaceBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id="workspace-1",
        agent_id="agent-1" if binding_state != "wrong_agent" else "other-agent",
        agent_config_version_id="snapshot-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="backend-1",
    )
    created = AgentWorkspaceBinding(
        id="binding-2",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id="workspace-2",
        agent_id="agent-1",
        agent_config_version_id="snapshot-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="backend-2",
    )
    looked_up: list[str] = []
    validated: list[str] = []
    created_scopes: list[WorkspaceOwnerScope] = []

    def get_binding(**kwargs: object) -> AgentWorkspaceBinding | None:
        looked_up.append(str(kwargs["binding_id"]))
        return None if binding_state == "missing" else existing

    def create_binding(**kwargs: object) -> AgentWorkspaceBinding:
        scope = kwargs["scope"]
        assert isinstance(scope, WorkspaceOwnerScope)
        created_scopes.append(scope)
        return created

    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_binding)
    monkeypatch.setattr(
        AgentWorkspaceService,
        "validate_binding_generation",
        lambda binding, **_kwargs: validated.append(binding.id),
    )
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create_binding)

    result = AgentEvaluationTargetService.ensure_row_binding(
        session=sqlite_session,
        target=target,
        tenant_id="tenant-1",
        run_item_id="row-1",
        binding_id=None if binding_state == "new" else "binding-1",
    )

    assert result is (existing if binding_state == "matching" else created)
    assert looked_up == ([] if binding_state == "new" else ["binding-1"])
    assert validated == (["binding-1"] if binding_state == "matching" else [])
    assert len(created_scopes) == (0 if binding_state == "matching" else 1)
    if created_scopes:
        scope = created_scopes[0]
        assert scope.owner_type == AgentWorkspaceOwnerType.EVALUATION_RUN_ITEM
        assert scope.owner_id == "row-1"
