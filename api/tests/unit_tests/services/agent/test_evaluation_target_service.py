from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services.agent.evaluation_target_service import AgentEvaluationTargetService


def _agent_soul_snapshot() -> dict[str, object]:
    return {
        "model": {
            "plugin_id": "langgenius/openai",
            "model_provider": "langgenius/openai/openai",
            "model": "gpt-4o-mini",
        }
    }


def test_resolve_active_snapshot_requires_a_published_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(
        id="agent-1",
        tenant_id="tenant-1",
        name="Research Agent",
        app_id="app-1",
        backing_app_id=None,
        active_config_snapshot_id="snapshot-1",
    )
    monkeypatch.setattr(
        "services.agent.evaluation_target_service.agent_has_workflow_callable_active_snapshot",
        MagicMock(return_value=False),
    )

    with pytest.raises(ValueError, match="published configuration"):
        AgentEvaluationTargetService.resolve_active_snapshot(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
        )


def test_resolve_pinned_snapshot_does_not_follow_a_later_publication(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent = SimpleNamespace(
        id="agent-1",
        tenant_id="tenant-1",
        name="Research Agent",
        app_id="app-1",
        backing_app_id=None,
        active_config_snapshot_id="snapshot-new",
    )
    pinned_snapshot = SimpleNamespace(
        id="snapshot-old",
        home_snapshot_id="home-old",
        config_snapshot_dict=_agent_soul_snapshot(),
    )
    app = SimpleNamespace(id="app-1")
    session = MagicMock()
    session.scalar.side_effect = [agent, pinned_snapshot, app]
    publication_check = MagicMock(return_value=False)
    monkeypatch.setattr(
        "services.agent.evaluation_target_service.agent_has_workflow_callable_active_snapshot",
        publication_check,
    )

    resolved = AgentEvaluationTargetService.resolve_active_snapshot(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        snapshot_id="snapshot-old",
    )

    assert resolved.config_snapshot_id == "snapshot-old"
    assert resolved.home_snapshot_id == "home-old"
    assert resolved.agent_soul.model is not None
    publication_check.assert_not_called()
    snapshot_statement = session.scalar.call_args_list[1].args[0]
    assert "snapshot-old" in snapshot_statement.compile().params.values()
