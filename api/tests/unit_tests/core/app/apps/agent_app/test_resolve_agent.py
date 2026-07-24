"""Unit tests for AgentAppGenerator agent/snapshot resolution.

Covers the DB-backed resolution helpers (the bound roster Agent + its published
Agent Soul snapshot) including every not-found error path, using a fake session
that returns queued rows.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from core.app.apps.agent_app.app_generator import AgentAppGenerator, AgentAppGeneratorError, AgentAppNotPublishedError
from core.app.entities.app_invoke_entities import InvokeFrom
from models.agent import AgentConfigDraft, AgentConfigDraftType, AgentConfigVersionKind, AgentScope, AgentSource
from models.agent_config_entities import AgentSoulConfig
from services.agent.workspace_service import (
    AgentWorkspaceBindingGenerationMismatchError,
    AgentWorkspaceService,
)

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
        self.scalar_statements: list[Any] = []

    def scalar(self, stmt: Any) -> Any:
        self.scalar_statements.append(stmt)
        return self._values.pop(0) if self._values else None

    def add(self, value: Any) -> None:
        self.added.append(value)

    def flush(self) -> None:
        self.flush_count += 1


def _snapshot() -> SimpleNamespace:
    return SimpleNamespace(id="snap-1", home_snapshot_id="home-1", config_snapshot_dict=_SOUL_DICT)


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
        session = _FakeScalarSession([None, _snapshot()])

        draft = AgentAppGenerator._resolve_debug_draft(
            tenant_id="t1",
            agent=agent,
            draft_type=None,
            draft_id=None,
            account_id=None,
            session=session,
        )

        assert draft.draft_type == AgentConfigDraftType.DRAFT
        assert draft.base_snapshot_id == "snap-1"
        assert session.added == [draft]
        assert session.flush_count == 1

    def test_stale_workflow_only_shared_draft_is_rebased_to_active_snapshot(self):
        agent = SimpleNamespace(
            id="agent-1",
            scope=AgentScope.WORKFLOW_ONLY,
            active_config_snapshot_id="snap-2",
            created_by="creator-1",
            updated_by="updater-1",
        )
        draft = AgentConfigDraft(
            id="draft-1",
            tenant_id="t1",
            agent_id="agent-1",
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            draft_owner_key="",
            base_snapshot_id="snap-1",
            home_snapshot_id="home-1",
            config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "old"}}),
        )
        active_snapshot = SimpleNamespace(
            id="snap-2",
            home_snapshot_id="home-2",
            config_snapshot_dict={"prompt": {"system_prompt": "new"}},
        )
        session = _FakeScalarSession([draft, active_snapshot])

        resolved = AgentAppGenerator._resolve_debug_draft(
            tenant_id="t1",
            agent=agent,
            draft_type=None,
            account_id=None,
            session=session,
        )

        assert resolved is draft
        assert resolved.id == "draft-1"
        assert resolved.base_snapshot_id == "snap-2"
        assert resolved.home_snapshot_id == "home-2"
        assert resolved.config_snapshot_dict["prompt"]["system_prompt"] == "new"
        assert session.flush_count == 1

    def test_build_draft_is_not_rebased_to_active_snapshot(self):
        agent = SimpleNamespace(
            id="agent-1",
            scope=AgentScope.WORKFLOW_ONLY,
            active_config_snapshot_id="snap-2",
            created_by="creator-1",
            updated_by="updater-1",
        )
        draft = AgentConfigDraft(
            id="build-draft-1",
            tenant_id="t1",
            agent_id="agent-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-1",
            draft_owner_key="account-1",
            base_snapshot_id="snap-1",
            home_snapshot_id="home-build",
            config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "build edit"}}),
        )
        session = _FakeScalarSession([draft])

        resolved = AgentAppGenerator._resolve_debug_draft(
            tenant_id="t1",
            agent=agent,
            draft_type=AgentConfigDraftType.DEBUG_BUILD.value,
            account_id="account-1",
            session=session,
        )

        assert resolved is draft
        assert resolved.base_snapshot_id == "snap-1"
        assert resolved.config_snapshot_dict["prompt"]["system_prompt"] == "build edit"
        assert session.flush_count == 0

    def test_build_draft_uses_exact_draft_id(self):
        agent = SimpleNamespace(
            id="agent-1",
            scope=AgentScope.WORKFLOW_ONLY,
            active_config_snapshot_id="snap-2",
            created_by="creator-1",
            updated_by="updater-1",
        )
        draft = AgentConfigDraft(
            id="exact-build-draft",
            tenant_id="t1",
            agent_id="agent-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-1",
            draft_owner_key="account-1",
            base_snapshot_id="snap-1",
            home_snapshot_id="home-build",
            config_snapshot=AgentSoulConfig(),
        )
        session = _FakeScalarSession([draft])
        statements: list[Any] = []
        scalar = session.scalar

        def capture_scalar(statement: Any) -> Any:
            statements.append(statement)
            return scalar(statement)

        session.scalar = capture_scalar  # type: ignore[method-assign]

        resolved = AgentAppGenerator._resolve_debug_draft(
            tenant_id="t1",
            agent=agent,
            draft_type=AgentConfigDraftType.DEBUG_BUILD.value,
            draft_id="exact-build-draft",
            account_id="account-1",
            session=session,
        )

        assert resolved is draft
        assert "agent_config_drafts.id =" in str(statements[0])
        assert "exact-build-draft" in statements[0].compile().params.values()


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

    def test_existing_conversation_resolves_binding_snapshot_instead_of_latest_active_snapshot(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        bound_agent = SimpleNamespace(
            id="agent-1",
            source=AgentSource.AGENT_APP,
            active_config_snapshot_id="snap-2",
            active_config_is_published=True,
        )
        inner_agent = SimpleNamespace(id="agent-1")
        pinned_snapshot = SimpleNamespace(
            id="snap-1",
            home_snapshot_id="home-1",
            config_snapshot_dict=_SOUL_DICT,
        )
        conversation = SimpleNamespace(id="conversation-1", agent_workspace_binding_id="binding-1")
        binding = SimpleNamespace(
            id="binding-1",
            agent_id="agent-1",
            base_home_snapshot_id="home-1",
            agent_config_version_id="snap-1",
            agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        )
        get_active_binding = MagicMock(return_value=binding)
        validate_generation = MagicMock()
        monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active_binding)
        monkeypatch.setattr(AgentWorkspaceService, "validate_binding_generation", validate_generation)
        session = _FakeScalarSession([bound_agent, inner_agent, pinned_snapshot])
        app_model = SimpleNamespace(id="app-1", tenant_id="t1")

        _, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
            app_model,
            invoke_from=InvokeFrom.WEB_APP,
            draft_type=None,
            user=SimpleNamespace(id="user-1"),
            session=session,
            conversation=conversation,
        )  # type: ignore[arg-type]

        assert config_id == "snap-1"
        assert config_version_kind == "snapshot"
        assert soul.prompt.system_prompt == "You are Iris."
        assert get_active_binding.call_args.kwargs["binding_id"] == "binding-1"
        validate_generation.assert_called_once_with(
            binding,
            base_home_snapshot_id="home-1",
            agent_config_version_id="snap-1",
            agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        )

    def test_existing_conversation_rejects_unavailable_binding(self, monkeypatch: pytest.MonkeyPatch):
        bound_agent = SimpleNamespace(
            id="agent-1",
            source=AgentSource.AGENT_APP,
            active_config_snapshot_id="snap-active",
            active_config_is_published=True,
        )
        conversation = SimpleNamespace(id="conversation-1", agent_workspace_binding_id="binding-missing")
        monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=None))

        with pytest.raises(AgentAppGeneratorError, match="Conversation participant Binding is unavailable"):
            AgentAppGenerator()._resolve_agent(
                SimpleNamespace(id="app-1", tenant_id="t1"),
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=SimpleNamespace(id="user-1"),
                session=_FakeScalarSession([bound_agent]),
                conversation=conversation,
            )  # type: ignore[arg-type]

    @pytest.mark.parametrize(
        ("binding_home_id", "binding_version_kind", "snapshot_home_id"),
        [
            ("home-binding", AgentConfigVersionKind.SNAPSHOT, "home-other"),
            ("home-pinned", AgentConfigVersionKind.DRAFT, "home-pinned"),
        ],
    )
    def test_existing_conversation_generation_mismatch_does_not_fallback_to_active_snapshot(
        self,
        monkeypatch: pytest.MonkeyPatch,
        binding_home_id: str,
        binding_version_kind: AgentConfigVersionKind,
        snapshot_home_id: str,
    ):
        bound_agent = SimpleNamespace(
            id="agent-1",
            source=AgentSource.AGENT_APP,
            active_config_snapshot_id="snap-active",
            active_config_is_published=True,
        )
        conversation = SimpleNamespace(id="conversation-1", agent_workspace_binding_id="binding-1")
        binding = SimpleNamespace(
            id="binding-1",
            agent_id="agent-1",
            base_home_snapshot_id=binding_home_id,
            agent_config_version_id="snap-pinned",
            agent_config_version_kind=binding_version_kind,
        )
        pinned_snapshot = SimpleNamespace(
            id="snap-pinned",
            home_snapshot_id=snapshot_home_id,
            config_snapshot_dict=_SOUL_DICT,
        )
        monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=binding))
        session = _FakeScalarSession([bound_agent, SimpleNamespace(id="agent-1"), pinned_snapshot])

        with pytest.raises(AgentWorkspaceBindingGenerationMismatchError):
            AgentAppGenerator()._resolve_agent(
                SimpleNamespace(id="app-1", tenant_id="t1"),
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=SimpleNamespace(id="user-1"),
                session=session,
                conversation=conversation,
            )  # type: ignore[arg-type]

        snapshot_query_params = session.scalar_statements[-1].compile().params.values()
        assert "snap-pinned" in snapshot_query_params
        assert "snap-active" not in snapshot_query_params

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
            scope=AgentScope.ROSTER,
            source=AgentSource.IMPORTED,
            active_config_snapshot_id="snap-1",
            active_config_is_published=False,
            created_by="creator-1",
            updated_by="updater-1",
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
