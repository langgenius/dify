"""Unit tests for AgentAppGenerator agent/snapshot resolution.

Covers the DB-backed resolution helpers (the bound roster Agent + its published
Agent Soul snapshot) including every not-found error path, using a fake session
that returns queued rows.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from core.app.apps.agent_app.app_generator import AgentAppGenerator, AgentAppGeneratorError, AgentAppNotPublishedError
from core.app.entities.app_invoke_entities import InvokeFrom
from models.agent import AgentConfigDraftType, AgentSource

_SOUL_DICT = {
    "model": {
        "plugin_id": "langgenius/openai",
        "model_provider": "langgenius/openai/openai",
        "model": "gpt-4o-mini",
    },
    "prompt": {"system_prompt": "You are Iris."},
}


class _FakeScalarSession:
    """Session stub whose scalar() pops the next queued row."""

    def __init__(self, values: list[Any]) -> None:
        self._values = list(values)
        self.added: list[Any] = []
        self.flush_count = 0

    def scalar(self, _stmt: Any) -> Any:
        return self._values.pop(0) if self._values else None

    def add(self, value: Any) -> None:
        self.added.append(value)

    def flush(self) -> None:
        self.flush_count += 1


def _snapshot() -> SimpleNamespace:
    return SimpleNamespace(id="snap-1", config_snapshot_dict=_SOUL_DICT)


class TestResolveAgentById:
    def test_success_returns_agent_snapshot_soul(self):
        agent = SimpleNamespace(id="agent-1")
        snapshot = _snapshot()
        session = _FakeScalarSession([agent, snapshot])

        resolved_agent, resolved_snapshot, soul = AgentAppGenerator._resolve_agent_by_id(
            tenant_id="t1", agent_id="agent-1", snapshot_id="snap-1", session=session
        )

        assert resolved_agent is agent
        assert resolved_snapshot is snapshot
        assert soul.prompt.system_prompt == "You are Iris."
        assert soul.model is not None
        assert soul.model.model == "gpt-4o-mini"

    def test_agent_missing_raises(self):
        session = _FakeScalarSession([None])
        with pytest.raises(AgentAppGeneratorError, match="Agent not found"):
            AgentAppGenerator._resolve_agent_by_id(tenant_id="t1", agent_id="x", snapshot_id="snap-1", session=session)

    def test_no_published_version_raises(self):
        session = _FakeScalarSession([SimpleNamespace(id="agent-1")])
        with pytest.raises(AgentAppGeneratorError, match="no published version"):
            AgentAppGenerator._resolve_agent_by_id(
                tenant_id="t1", agent_id="agent-1", snapshot_id=None, session=session
            )

    def test_snapshot_missing_raises(self):
        session = _FakeScalarSession([SimpleNamespace(id="agent-1"), None])
        with pytest.raises(AgentAppGeneratorError, match="published version not found"):
            AgentAppGenerator._resolve_agent_by_id(
                tenant_id="t1",
                agent_id="agent-1",
                snapshot_id="snap-1",
                session=session,
            )


class TestResolveDebugDraft:
    def test_missing_shared_draft_is_created_with_supplied_session(self):
        agent = SimpleNamespace(
            id="agent-1",
            active_config_snapshot_id="snap-1",
            created_by="creator-1",
            updated_by="updater-1",
        )
        session = _FakeScalarSession([None, SimpleNamespace(id="agent-1"), _snapshot()])

        draft = AgentAppGenerator._resolve_debug_draft(
            tenant_id="t1",
            agent=agent,
            draft_type=None,
            account_id=None,
            session=session,
        )

        assert draft.draft_type == AgentConfigDraftType.DRAFT
        assert draft.base_snapshot_id == "snap-1"
        assert session.added == [draft]
        assert session.flush_count == 1


class TestResolveAgent:
    def test_success_chains_to_resolve_by_id(self):
        bound_agent = SimpleNamespace(
            id="agent-1",
            source=AgentSource.AGENT_APP,
            active_config_snapshot_id="snap-1",
            active_config_is_published=True,
        )
        inner_agent = SimpleNamespace(id="agent-1")
        snapshot = _snapshot()
        # scalar order: bound agent (in _resolve_agent), then agent + snapshot (in _resolve_agent_by_id)
        session = _FakeScalarSession([bound_agent, inner_agent, snapshot])
        app_model = SimpleNamespace(id="app-1", tenant_id="t1")

        agent, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
            app_model,
            invoke_from=InvokeFrom.WEB_APP,
            draft_type=None,
            user=SimpleNamespace(id="user-1"),
            session=session,
        )  # type: ignore[arg-type]

        assert agent is bound_agent
        assert config_id == snapshot.id
        assert config_version_kind == "snapshot"
        assert soul.model is not None

    def test_unpublished_draft_still_resolves_active_snapshot(self):
        bound_agent = SimpleNamespace(
            id="agent-1",
            source=AgentSource.AGENT_APP,
            active_config_snapshot_id="snap-1",
            active_config_is_published=False,
        )
        inner_agent = SimpleNamespace(id="agent-1")
        snapshot = _snapshot()
        session = _FakeScalarSession([bound_agent, inner_agent, snapshot])
        app_model = SimpleNamespace(id="app-1", tenant_id="t1")

        agent, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
            app_model,
            invoke_from=InvokeFrom.WEB_APP,
            draft_type=None,
            user=SimpleNamespace(id="user-1"),
            session=session,
        )  # type: ignore[arg-type]

        assert agent is bound_agent
        assert config_id == snapshot.id
        assert config_version_kind == "snapshot"
        assert soul.prompt.system_prompt == "You are Iris."

    def test_unpublished_imported_agent_is_not_available_to_public_runtime(self):
        bound_agent = SimpleNamespace(
            id="agent-1",
            source=AgentSource.IMPORTED,
            active_config_snapshot_id="snap-1",
            active_config_is_published=False,
        )
        session = _FakeScalarSession([bound_agent])
        app_model = SimpleNamespace(id="app-1", tenant_id="t1")

        with pytest.raises(AgentAppNotPublishedError, match="not been published"):
            AgentAppGenerator()._resolve_agent(
                app_model,
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=SimpleNamespace(id="user-1"),
                session=session,
            )  # type: ignore[arg-type]

    def test_unpublished_imported_agent_remains_available_to_debugger(self):
        bound_agent = SimpleNamespace(
            id="agent-1",
            source=AgentSource.IMPORTED,
            active_config_snapshot_id="snap-1",
            active_config_is_published=False,
        )
        draft = SimpleNamespace(id="draft-1", draft_type="draft", config_snapshot_dict=_SOUL_DICT)
        session = _FakeScalarSession([bound_agent, draft])
        app_model = SimpleNamespace(id="app-1", tenant_id="t1")

        agent, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
            app_model,
            invoke_from=InvokeFrom.DEBUGGER,
            draft_type=None,
            user=SimpleNamespace(id="user-1"),
            session=session,
        )  # type: ignore[arg-type]

        assert agent is bound_agent
        assert config_id == draft.id
        assert config_version_kind == "draft"
        assert soul.prompt.system_prompt == "You are Iris."

    def test_agent_without_active_snapshot_raises_before_model_resolution(self):
        bound_agent = SimpleNamespace(
            id="agent-1",
            source=AgentSource.AGENT_APP,
            active_config_snapshot_id=None,
            active_config_is_published=False,
        )
        session = _FakeScalarSession([bound_agent])
        app_model = SimpleNamespace(id="app-1", tenant_id="t1")

        with pytest.raises(AgentAppNotPublishedError, match="not been published"):
            AgentAppGenerator()._resolve_agent(
                app_model,
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=SimpleNamespace(id="user-1"),
                session=session,
            )  # type: ignore[arg-type]

    def test_unbound_app_raises(self):
        session = _FakeScalarSession([None])
        app_model = SimpleNamespace(id="app-1", tenant_id="t1")
        with pytest.raises(AgentAppGeneratorError, match="has no bound Agent"):
            AgentAppGenerator()._resolve_agent(
                app_model,
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=SimpleNamespace(id="user-1"),
                session=session,
            )  # type: ignore[arg-type]
