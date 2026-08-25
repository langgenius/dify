"""Unit tests for AgentAppGenerator agent/snapshot resolution.

Covers the DB-backed resolution helpers (the bound roster Agent + its published
Agent Soul snapshot) including every not-found error path, using persisted rows
in the shared SQLite test database.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from core.app.apps.agent_app import app_generator
from core.app.apps.agent_app.app_generator import AgentAppGenerator, AgentAppGeneratorError, AgentAppNotPublishedError
from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import Account
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentScope,
    AgentSource,
    AgentWorkingResourceStatus,
    AgentWorkspaceBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import App, AppMode, Conversation
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


def _agent(
    *,
    agent_id: str = "agent-1",
    scope: AgentScope = AgentScope.ROSTER,
    source: AgentSource = AgentSource.AGENT_APP,
    active_snapshot_id: str | None = "snap-1",
    published: bool = True,
) -> Agent:
    return Agent(
        id=agent_id,
        tenant_id="t1",
        name=f"Agent {agent_id}",
        scope=scope,
        source=source,
        app_id="app-1" if scope == AgentScope.ROSTER else None,
        backing_app_id="app-1" if scope == AgentScope.WORKFLOW_ONLY else None,
        active_config_snapshot_id=active_snapshot_id,
        active_config_has_model=True,
        active_config_is_published=published,
        created_by="creator-1",
        updated_by="updater-1",
    )


def _snapshot(
    *, snapshot_id: str = "snap-1", agent_id: str = "agent-1", home_snapshot_id: str = "home-1"
) -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id=snapshot_id,
        tenant_id="t1",
        agent_id=agent_id,
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(_SOUL_DICT),
        home_snapshot_id=home_snapshot_id,
        created_by="creator-1",
    )


def _app() -> App:
    return App(
        id="app-1",
        tenant_id="t1",
        name="Agent App",
        mode=AppMode.AGENT_CHAT,
        enable_site=False,
        enable_api=False,
    )


def _account() -> Account:
    account = Account(name="Agent User", email="agent-user@example.com")
    account.id = "user-1"
    return account


def _conversation(*, binding_id: str) -> Conversation:
    return Conversation(id="conversation-1", app_id="app-1", agent_workspace_binding_id=binding_id)


def _binding(
    *,
    home_snapshot_id: str = "home-1",
    version_id: str = "snap-1",
    version_kind: AgentConfigVersionKind = AgentConfigVersionKind.SNAPSHOT,
) -> AgentWorkspaceBinding:
    return AgentWorkspaceBinding(
        id="binding-1",
        tenant_id="t1",
        app_id="app-1",
        workspace_id="workspace-1",
        agent_id="agent-1",
        base_home_snapshot_id=home_snapshot_id,
        agent_config_version_id=version_id,
        agent_config_version_kind=version_kind,
        backend_binding_ref="backend-binding-1",
        status=AgentWorkingResourceStatus.ACTIVE,
    )


def _persist(session: Session, *models: object) -> None:
    session.add_all(models)
    session.commit()


class TestResolveAgentById:
    def test_success_returns_agent_snapshot_soul(self, sqlite_session: Session):
        agent = _agent()
        snapshot = _snapshot()
        sqlite_session.add_all([agent, snapshot])
        sqlite_session.commit()

        resolved_agent, resolved_snapshot, soul = AgentAppGenerator._resolve_agent_by_id(
            tenant_id="t1", agent_id="agent-1", snapshot_id="snap-1", session=sqlite_session
        )

        assert resolved_agent is agent
        assert resolved_snapshot is snapshot
        assert soul.prompt.system_prompt == "You are Iris."
        assert soul.model is not None
        assert soul.model.model == "gpt-4o-mini"

    def test_agent_missing_raises(self, sqlite_session: Session):
        with pytest.raises(AgentAppGeneratorError, match="Agent not found"):
            AgentAppGenerator._resolve_agent_by_id(
                tenant_id="t1", agent_id="x", snapshot_id="snap-1", session=sqlite_session
            )

    def test_no_published_version_raises(self, sqlite_session: Session):
        sqlite_session.add(_agent(active_snapshot_id=None))
        sqlite_session.commit()
        with pytest.raises(AgentAppGeneratorError, match="no published version"):
            AgentAppGenerator._resolve_agent_by_id(
                tenant_id="t1", agent_id="agent-1", snapshot_id=None, session=sqlite_session
            )

    def test_snapshot_missing_raises(self, sqlite_session: Session):
        sqlite_session.add(_agent())
        sqlite_session.commit()
        with pytest.raises(AgentAppGeneratorError, match="published version not found"):
            AgentAppGenerator._resolve_agent_by_id(
                tenant_id="t1",
                agent_id="agent-1",
                snapshot_id="snap-1",
                session=sqlite_session,
            )


class TestResolveDebugDraft:
    def test_missing_shared_draft_is_created_with_supplied_session(self, sqlite_session: Session):
        agent = _agent()
        sqlite_session.add_all([agent, _snapshot()])
        sqlite_session.commit()
        flush_count = 0

        def _record_flush(_session: Session, _context: object) -> None:
            nonlocal flush_count
            flush_count += 1

        event.listen(sqlite_session, "after_flush", _record_flush)

        draft = AgentAppGenerator._resolve_debug_draft(
            tenant_id="t1",
            agent=agent,
            draft_type=None,
            draft_id=None,
            account_id=None,
            session=sqlite_session,
        )

        assert draft.draft_type == AgentConfigDraftType.DRAFT
        assert draft.base_snapshot_id == "snap-1"
        assert sqlite_session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.id == draft.id)) is draft
        assert flush_count == 1

    def test_stale_workflow_only_shared_draft_is_rebased_to_active_snapshot(self, sqlite_session: Session):
        agent = _agent(scope=AgentScope.WORKFLOW_ONLY, active_snapshot_id="snap-2")
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
        active_snapshot = AgentConfigSnapshot(
            id="snap-2",
            tenant_id="t1",
            agent_id="agent-1",
            version=2,
            config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "new"}}),
            home_snapshot_id="home-2",
            created_by="creator-1",
        )
        sqlite_session.add_all([agent, draft, active_snapshot])
        sqlite_session.commit()
        flush_count = 0

        def _record_flush(_session: Session, _context: object) -> None:
            nonlocal flush_count
            flush_count += 1

        event.listen(sqlite_session, "after_flush", _record_flush)

        resolved = AgentAppGenerator._resolve_debug_draft(
            tenant_id="t1",
            agent=agent,
            draft_type=None,
            account_id=None,
            session=sqlite_session,
        )

        assert resolved is draft
        assert resolved.id == "draft-1"
        assert resolved.base_snapshot_id == "snap-2"
        assert resolved.home_snapshot_id == "home-2"
        assert resolved.config_snapshot_dict["prompt"]["system_prompt"] == "new"
        assert flush_count == 1

    def test_build_draft_is_not_rebased_to_active_snapshot(self, sqlite_session: Session):
        agent = _agent(scope=AgentScope.WORKFLOW_ONLY, active_snapshot_id="snap-2")
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
        sqlite_session.add_all([agent, draft])
        sqlite_session.commit()

        resolved = AgentAppGenerator._resolve_debug_draft(
            tenant_id="t1",
            agent=agent,
            draft_type=AgentConfigDraftType.DEBUG_BUILD.value,
            account_id="account-1",
            session=sqlite_session,
        )

        assert resolved is draft
        assert resolved.base_snapshot_id == "snap-1"
        assert resolved.config_snapshot_dict["prompt"]["system_prompt"] == "build edit"
        assert not sqlite_session.dirty

    def test_build_draft_uses_exact_draft_id(self, sqlite_session: Session):
        agent = _agent(scope=AgentScope.WORKFLOW_ONLY, active_snapshot_id="snap-2")
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
        newer_decoy = AgentConfigDraft(
            id="newer-build-draft",
            tenant_id="t1",
            agent_id="agent-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-1",
            draft_owner_key="account-1-decoy",
            base_snapshot_id="snap-2",
            home_snapshot_id="home-decoy",
            config_snapshot=AgentSoulConfig(prompt={"system_prompt": "decoy"}),
        )
        sqlite_session.add_all([agent, draft, newer_decoy])
        sqlite_session.commit()

        resolved = AgentAppGenerator._resolve_debug_draft(
            tenant_id="t1",
            agent=agent,
            draft_type=AgentConfigDraftType.DEBUG_BUILD.value,
            draft_id="exact-build-draft",
            account_id="account-1",
            session=sqlite_session,
        )

        assert resolved is draft
        assert resolved.id == "exact-build-draft"


class TestResolveAgent:
    @pytest.fixture(autouse=True)
    def _publish_visibility(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def is_publish_visible(*, agent: Agent, **_kwargs: object) -> bool:
            return bool(agent.active_config_is_published)

        monkeypatch.setattr(
            app_generator,
            "agent_has_workflow_callable_active_snapshot",
            is_publish_visible,
        )

    def test_success_chains_to_resolve_by_id(self, sqlite_session: Session):
        bound_agent = _agent()
        snapshot = _snapshot()
        _persist(sqlite_session, bound_agent, snapshot)
        app_model = _app()

        agent, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
            app_model,
            invoke_from=InvokeFrom.WEB_APP,
            draft_type=None,
            user=_account(),
            session=sqlite_session,
        )

        assert agent is bound_agent
        assert config_id == snapshot.id
        assert config_version_kind == "snapshot"
        assert soul.model is not None

    def test_unpublished_draft_still_resolves_active_snapshot(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        bound_agent = _agent(published=False)
        snapshot = _snapshot()
        _persist(sqlite_session, bound_agent, snapshot)
        app_model = _app()
        monkeypatch.setattr(app_generator, "agent_has_workflow_callable_active_snapshot", lambda **_kwargs: True)

        agent, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
            app_model,
            invoke_from=InvokeFrom.WEB_APP,
            draft_type=None,
            user=_account(),
            session=sqlite_session,
        )

        assert agent is bound_agent
        assert config_id == snapshot.id
        assert config_version_kind == "snapshot"
        assert soul.prompt.system_prompt == "You are Iris."

    def test_existing_conversation_resolves_binding_snapshot_instead_of_latest_active_snapshot(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        bound_agent = _agent(active_snapshot_id="snap-2")
        pinned_snapshot = _snapshot()
        _persist(sqlite_session, bound_agent, pinned_snapshot)
        conversation = _conversation(binding_id="binding-1")
        binding = _binding()
        get_active_binding = MagicMock(return_value=binding)
        validate_generation = MagicMock()
        monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active_binding)
        monkeypatch.setattr(AgentWorkspaceService, "validate_binding_generation", validate_generation)
        app_model = _app()

        _, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
            app_model,
            invoke_from=InvokeFrom.WEB_APP,
            draft_type=None,
            user=_account(),
            session=sqlite_session,
            conversation=conversation,
        )

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

    def test_existing_conversation_rejects_unavailable_binding(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        bound_agent = _agent(active_snapshot_id="snap-active")
        _persist(sqlite_session, bound_agent)
        conversation = _conversation(binding_id="binding-missing")
        monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=None))

        with pytest.raises(AgentAppGeneratorError, match="Conversation participant Binding is unavailable"):
            AgentAppGenerator()._resolve_agent(
                _app(),
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=_account(),
                session=sqlite_session,
                conversation=conversation,
            )

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
        sqlite_session: Session,
        binding_home_id: str,
        binding_version_kind: AgentConfigVersionKind,
        snapshot_home_id: str,
    ):
        bound_agent = _agent(active_snapshot_id="snap-active")
        conversation = _conversation(binding_id="binding-1")
        binding = _binding(
            home_snapshot_id=binding_home_id,
            version_id="snap-pinned",
            version_kind=binding_version_kind,
        )
        pinned_snapshot = _snapshot(snapshot_id="snap-pinned", home_snapshot_id=snapshot_home_id)
        _persist(sqlite_session, bound_agent, pinned_snapshot)
        monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=binding))

        with pytest.raises(AgentWorkspaceBindingGenerationMismatchError):
            AgentAppGenerator()._resolve_agent(
                _app(),
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=_account(),
                session=sqlite_session,
                conversation=conversation,
            )

    def test_unpublished_imported_agent_is_not_available_to_public_runtime(self, sqlite_session: Session):
        bound_agent = _agent(source=AgentSource.IMPORTED, published=False)
        _persist(sqlite_session, bound_agent)
        app_model = _app()

        with pytest.raises(AgentAppNotPublishedError, match="not been published"):
            AgentAppGenerator()._resolve_agent(
                app_model,
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=_account(),
                session=sqlite_session,
            )

    def test_never_published_agent_app_is_not_available_to_public_runtime(self, sqlite_session: Session):
        bound_agent = _agent(published=False)
        _persist(sqlite_session, bound_agent)

        with pytest.raises(AgentAppNotPublishedError, match="not been published"):
            AgentAppGenerator()._resolve_agent(
                _app(),
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=_account(),
                session=sqlite_session,
            )

    def test_unpublished_imported_agent_remains_available_to_debugger(self, sqlite_session: Session):
        bound_agent = _agent(source=AgentSource.IMPORTED, published=False)
        draft = AgentConfigDraft(
            id="draft-1",
            tenant_id="t1",
            agent_id="agent-1",
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            draft_owner_key="",
            base_snapshot_id="snap-1",
            home_snapshot_id="home-1",
            config_snapshot=AgentSoulConfig.model_validate(_SOUL_DICT),
        )
        _persist(sqlite_session, bound_agent, draft)
        app_model = _app()

        agent, config_id, config_version_kind, soul = AgentAppGenerator()._resolve_agent(
            app_model,
            invoke_from=InvokeFrom.DEBUGGER,
            draft_type=None,
            user=_account(),
            session=sqlite_session,
        )

        assert agent is bound_agent
        assert config_id == draft.id
        assert config_version_kind == "draft"
        assert soul.prompt.system_prompt == "You are Iris."

    def test_agent_without_active_snapshot_raises_before_model_resolution(self, sqlite_session: Session):
        bound_agent = _agent(active_snapshot_id=None, published=False)
        _persist(sqlite_session, bound_agent)
        app_model = _app()

        with pytest.raises(AgentAppNotPublishedError, match="not been published"):
            AgentAppGenerator()._resolve_agent(
                app_model,
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=_account(),
                session=sqlite_session,
            )

    def test_unbound_app_raises(self, sqlite_session: Session):
        app_model = _app()
        with pytest.raises(AgentAppGeneratorError, match="has no bound Agent"):
            AgentAppGenerator()._resolve_agent(
                app_model,
                invoke_from=InvokeFrom.WEB_APP,
                draft_type=None,
                user=_account(),
                session=sqlite_session,
            )
