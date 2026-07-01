"""Unit tests for AgentAppGenerator agent/snapshot resolution.

Covers the DB-backed resolution helpers (the bound roster Agent + its published
Agent Soul snapshot) including every not-found error path, using a fake session
that returns queued rows.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from core.app.apps.agent_app import app_generator as gen_mod
from core.app.apps.agent_app.app_generator import AgentAppGenerator, AgentAppGeneratorError
from core.app.entities.app_invoke_entities import InvokeFrom

_SOUL_DICT = {
    "model": {
        "plugin_id": "langgenius/openai",
        "model_provider": "langgenius/openai/openai",
        "model": "gpt-4o-mini",
    },
    "prompt": {"system_prompt": "You are Iris."},
}


class _FakeScalarSession:
    """db.session stub: scalar() pops the next queued row (ignores the stmt)."""

    def __init__(self, values: list[Any]) -> None:
        self._values = list(values)

    def scalar(self, _stmt: Any) -> Any:
        return self._values.pop(0) if self._values else None


def _patch_session(monkeypatch, values: list[Any]) -> None:
    monkeypatch.setattr(gen_mod, "db", SimpleNamespace(session=_FakeScalarSession(values)))


def _snapshot() -> SimpleNamespace:
    return SimpleNamespace(id="snap-1", config_snapshot_dict=_SOUL_DICT)


class TestResolveAgentById:
    def test_success_returns_agent_snapshot_soul(self, monkeypatch: pytest.MonkeyPatch):
        agent = SimpleNamespace(id="agent-1")
        snapshot = _snapshot()
        _patch_session(monkeypatch, [agent, snapshot])

        resolved_agent, resolved_snapshot, soul = AgentAppGenerator._resolve_agent_by_id(
            tenant_id="t1", agent_id="agent-1", snapshot_id="snap-1"
        )

        assert resolved_agent is agent
        assert resolved_snapshot is snapshot
        assert soul.prompt.system_prompt == "You are Iris."
        assert soul.model is not None
        assert soul.model.model == "gpt-4o-mini"

    def test_agent_missing_raises(self, monkeypatch: pytest.MonkeyPatch):
        _patch_session(monkeypatch, [None])
        with pytest.raises(AgentAppGeneratorError, match="Agent not found"):
            AgentAppGenerator._resolve_agent_by_id(tenant_id="t1", agent_id="x", snapshot_id="snap-1")

    def test_no_published_version_raises(self, monkeypatch: pytest.MonkeyPatch):
        _patch_session(monkeypatch, [SimpleNamespace(id="agent-1")])
        with pytest.raises(AgentAppGeneratorError, match="no published version"):
            AgentAppGenerator._resolve_agent_by_id(tenant_id="t1", agent_id="agent-1", snapshot_id=None)

    def test_snapshot_missing_raises(self, monkeypatch: pytest.MonkeyPatch):
        _patch_session(monkeypatch, [SimpleNamespace(id="agent-1"), None])
        with pytest.raises(AgentAppGeneratorError, match="published version not found"):
            AgentAppGenerator._resolve_agent_by_id(tenant_id="t1", agent_id="agent-1", snapshot_id="snap-1")


class TestResolveAgent:
    def test_success_chains_to_resolve_by_id(self, monkeypatch: pytest.MonkeyPatch):
        bound_agent = SimpleNamespace(id="agent-1", active_config_snapshot_id="snap-1")
        inner_agent = SimpleNamespace(id="agent-1")
        snapshot = _snapshot()
        # scalar order: bound agent (in _resolve_agent), then agent + snapshot (in _resolve_agent_by_id)
        _patch_session(monkeypatch, [bound_agent, inner_agent, snapshot])
        app_model = SimpleNamespace(id="app-1", tenant_id="t1")

        agent, snap, soul = AgentAppGenerator()._resolve_agent(
            app_model,
            invoke_from=InvokeFrom.WEB_APP,
            draft_type=None,
            user=SimpleNamespace(id="user-1"),
        )  # type: ignore[arg-type]

        assert agent is bound_agent
        assert snap == snapshot.id
        assert soul.model is not None

    def test_unbound_app_raises(self, monkeypatch: pytest.MonkeyPatch):
        _patch_session(monkeypatch, [None])
        app_model = SimpleNamespace(id="app-1", tenant_id="t1")
        with pytest.raises(AgentAppGeneratorError, match="has no bound Agent"):
            AgentAppGenerator()._resolve_agent(
                app_model,
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=SimpleNamespace(id="user-1"),
            )  # type: ignore[arg-type]
