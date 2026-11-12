import pytest
from sqlalchemy.orm import Session

from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource
from models.model import AppMode
from services.agent.evaluation_target_service import AgentEvaluationTargetService
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
