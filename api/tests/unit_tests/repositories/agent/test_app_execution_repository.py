"""Agent App generation uses persisted versions and exact workspace/actor ownership."""

from datetime import datetime

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from core.agent.workspace import AgentWorkspaceBindingGenerationMismatchError
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource
from repositories.agent.app_execution_repository import AgentAppExecutionRepository
from services.app.generation.errors import AgentAppGeneratorError, AgentAppNotPublishedError
from tests.unit_tests.model_factories import make_conversation


def soul(prompt="Published"):
    return AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "langgenius/openai/openai",
                "model": "gpt-4o-mini",
            },
            "prompt": {"system_prompt": prompt},
        }
    )


def seed_agent(sqlite_session_factory: sessionmaker[Session]):
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                Agent(
                    id="agent",
                    tenant_id="tenant",
                    app_id="app",
                    name="Agent",
                    scope=AgentScope.ROSTER,
                    source=AgentSource.AGENT_APP,
                    status=AgentStatus.ACTIVE,
                    active_config_snapshot_id="snapshot",
                    active_config_has_model=True,
                    active_config_is_published=True,
                    created_by="account",
                ),
                AgentConfigSnapshot(
                    id="snapshot",
                    tenant_id="tenant",
                    agent_id="agent",
                    version=1,
                    config_snapshot=soul(),
                    home_snapshot_id="home",
                    created_by="account",
                ),
                AgentConfigRevision(
                    tenant_id="tenant",
                    agent_id="agent",
                    current_snapshot_id="snapshot",
                    revision=1,
                    operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
                ),
            ]
        )
    return sqlite_session_factory


@pytest.fixture
def sessions(sqlite_session_factory: sessionmaker[Session]):
    return seed_agent(sqlite_session_factory)


def resolve(sessions, *, debug=False, **kwargs):
    return AgentAppExecutionRepository(sessions).resolve(
        tenant_id="tenant",
        app_id="app",
        debug=debug,
        account_id=kwargs.pop("account_id", "account"),
        draft_type=kwargs.pop("draft_type", None),
        conversation_id=kwargs.pop("conversation_id", None),
        **kwargs,
    )


def add_participant(session):
    conversation = make_conversation(
        conversation_id="conversation",
        app_id="app",
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
        agent_workspace_binding_id="binding",
    )
    workspace = AgentWorkspace(
        id="workspace",
        tenant_id="tenant",
        app_id="app",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation",
        owner_scope_key="root",
        backend_workspace_ref="backend-workspace",
    )
    binding = AgentWorkspaceBinding(
        id="binding",
        tenant_id="tenant",
        app_id="app",
        workspace_id="workspace",
        agent_id="agent",
        base_home_snapshot_id="home",
        agent_config_version_id="snapshot",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="backend-binding",
    )
    session.add_all([conversation, workspace, binding])
    return workspace, binding


def test_new_turn_uses_published_snapshot_even_after_draft_edit(sessions):
    with sessions.begin() as session:
        session.get(Agent, "agent").active_config_is_published = False
    result = resolve(sessions)
    assert (result.agent_id, result.version_id, result.version_kind, result.home_snapshot_id) == (
        "agent",
        "snapshot",
        "snapshot",
        "home",
    )
    assert result.soul.prompt.system_prompt == "Published"


def test_seeded_snapshot_cannot_be_used_before_publication(sessions):
    with sessions.begin() as session:
        session.execute(delete(AgentConfigRevision))
    with pytest.raises(AgentAppNotPublishedError):
        resolve(sessions)
    # The editable draft still exists as a valid console surface.
    assert resolve(sessions, debug=True).version_kind == "draft"


@pytest.mark.parametrize(
    "change", ["tenant", "app", "archived", "missing_agent", "missing_snapshot", "foreign_snapshot"]
)
def test_unavailable_generation_is_rejected(sessions, change):
    with sessions.begin() as session:
        agent = session.get(Agent, "agent")
        if change == "tenant":
            agent.tenant_id = "other"
        elif change == "app":
            agent.app_id = "other"
        elif change == "archived":
            agent.status = AgentStatus.ARCHIVED
        elif change == "missing_agent":
            session.delete(agent)
        elif change == "missing_snapshot":
            session.delete(session.get(AgentConfigSnapshot, "snapshot"))
        else:
            session.get(AgentConfigSnapshot, "snapshot").agent_id = "other"
    with pytest.raises(AgentAppGeneratorError):
        resolve(sessions)


def test_normal_draft_is_committed_and_reused_with_edits(sessions):
    initial = resolve(sessions, debug=True)
    with sessions.begin() as session:
        draft = session.get(AgentConfigDraft, initial.version_id)
        assert draft is not None
        assert draft.account_id is None
        draft.config_snapshot = soul("Edited")
    again = resolve(sessions, debug=True)
    assert initial.version_id == again.version_id
    assert again.soul.prompt.system_prompt == "Edited"


def test_workflow_only_normal_draft_rebases_to_active_snapshot(sessions):
    with sessions.begin() as session:
        agent = session.get(Agent, "agent")
        agent.scope = AgentScope.WORKFLOW_ONLY
        agent.app_id = None
        agent.backing_app_id = "app"
    first = resolve(sessions, debug=True)
    with sessions.begin() as session:
        session.add(
            AgentConfigSnapshot(
                id="new",
                tenant_id="tenant",
                agent_id="agent",
                version=2,
                config_snapshot=soul("New"),
                home_snapshot_id="new-home",
            )
        )
        session.get(Agent, "agent").active_config_snapshot_id = "new"
    rebased = resolve(sessions, debug=True)
    assert rebased.version_id == first.version_id
    assert rebased.soul.prompt.system_prompt == "New"
    assert rebased.home_snapshot_id == "new-home"


def test_existing_conversation_keeps_immutable_published_generation(sessions):
    with sessions.begin() as session:
        add_participant(session)
        session.add_all(
            [
                AgentConfigSnapshot(
                    id="new", tenant_id="tenant", agent_id="agent", version=2, config_snapshot=soul("New")
                ),
                AgentConfigRevision(
                    tenant_id="tenant",
                    agent_id="agent",
                    current_snapshot_id="new",
                    revision=2,
                    operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
                ),
            ]
        )
        session.get(Agent, "agent").active_config_snapshot_id = "new"
    assert resolve(sessions).version_id == "new"
    assert resolve(sessions, conversation_id="conversation").version_id == "snapshot"


@pytest.mark.parametrize(
    "change", ["home", "kind", "agent", "workspace_owner", "workspace_app", "binding_tenant", "retired"]
)
def test_conversation_binding_cannot_cross_generation_or_ownership(sessions, change):
    with sessions.begin() as session:
        workspace, binding = add_participant(session)
        if change == "home":
            binding.base_home_snapshot_id = "another-home"
        elif change == "kind":
            binding.agent_config_version_kind = AgentConfigVersionKind.DRAFT
        elif change == "agent":
            binding.agent_id = "other"
        elif change == "workspace_owner":
            workspace.owner_id = "other"
        elif change == "workspace_app":
            workspace.app_id = "other"
        elif change == "binding_tenant":
            binding.tenant_id = "other"
        else:
            binding.status = AgentWorkingResourceStatus.RETIRED
    with pytest.raises((AgentAppGeneratorError, AgentWorkspaceBindingGenerationMismatchError)):
        resolve(sessions, conversation_id="conversation")


def add_build_draft(session, *, draft_id="build", account="account", binding_id=None, updated_at=None):
    draft = AgentConfigDraft(
        id=draft_id,
        tenant_id="tenant",
        agent_id="agent",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id=account,
        draft_owner_key=account,
        base_snapshot_id="snapshot",
        config_snapshot=soul(draft_id),
        agent_workspace_binding_id=binding_id,
        updated_at=updated_at or datetime(2026, 1, 1),
    )
    session.add(draft)
    return draft


def test_build_draft_is_scoped_to_account(sessions):
    with sessions.begin() as session:
        add_build_draft(session)
    assert resolve(sessions, debug=True, draft_type="debug_build").version_id == "build"
    for account in (None, "other"):
        with pytest.raises(AgentAppGeneratorError):
            resolve(sessions, debug=True, draft_type="debug_build", account_id=account)


def test_resume_uses_form_bound_build_draft(sessions):
    with sessions.begin() as session:
        workspace, binding = add_participant(session)
        workspace.owner_type = AgentWorkspaceOwnerType.BUILD_DRAFT
        workspace.owner_id = "build"
        binding.pending_form_id = "form"
        binding.base_home_snapshot_id = None
        binding.agent_config_version_kind = AgentConfigVersionKind.BUILD_DRAFT
        binding.agent_config_version_id = "build"
        add_build_draft(session, binding_id=binding.id)
    result = resolve(sessions, debug=True, conversation_id="conversation", form_id="form")
    assert result.version_id == "build"
    assert result.version_kind == "build_draft"


@pytest.mark.parametrize("change", ["owner", "workspace_tenant", "workspace_app", "version", "home"])
def test_resume_validates_build_participant_owner_and_generation(sessions, change):
    with sessions.begin() as session:
        workspace, binding = add_participant(session)
        workspace.owner_type = AgentWorkspaceOwnerType.BUILD_DRAFT
        workspace.owner_id = "build"
        binding.pending_form_id = "form"
        binding.base_home_snapshot_id = None
        binding.agent_config_version_id = "build"
        binding.agent_config_version_kind = AgentConfigVersionKind.BUILD_DRAFT
        add_build_draft(session, binding_id=binding.id)
        if change == "owner":
            workspace.owner_id = "another-draft"
        elif change == "workspace_tenant":
            workspace.tenant_id = "other"
        elif change == "workspace_app":
            workspace.app_id = "other"
        elif change == "version":
            binding.agent_config_version_id = "other"
        else:
            binding.base_home_snapshot_id = "other"
    with pytest.raises((AgentAppGeneratorError, AgentWorkspaceBindingGenerationMismatchError)):
        resolve(sessions, debug=True, conversation_id="conversation", form_id="form")


@pytest.mark.parametrize("change", ["app", "tenant", "agent", "account"])
def test_resume_ignores_build_binding_outside_caller_scope(sessions, change):
    with sessions.begin() as session:
        _, binding = add_participant(session)
        binding.pending_form_id = "form"
        draft = add_build_draft(session, binding_id=binding.id)
        if change == "app":
            binding.app_id = "other"
        elif change == "tenant":
            binding.tenant_id = "other"
        elif change == "agent":
            binding.agent_id = "other"
        else:
            draft.account_id = "other"
    assert resolve(sessions, debug=True, conversation_id="conversation", form_id="form").version_kind == "draft"


@pytest.mark.parametrize("change", ["app", "tenant", "kind", "account"])
def test_worker_reload_requires_same_owner_and_version_kind(sessions, change):
    with sessions.begin() as session:
        add_build_draft(session)
    params = {
        "tenant_id": "tenant",
        "app_id": "app",
        "agent_id": "agent",
        "version_id": "build",
        "version_kind": "build_draft",
        "account_id": "account",
    }
    result = AgentAppExecutionRepository(sessions).version(**params)
    assert result.version_kind == "build_draft"
    params[{"app": "app_id", "tenant": "tenant_id", "kind": "version_kind", "account": "account_id"}[change]] = (
        "snapshot" if change == "kind" else "other"
    )
    with pytest.raises(AgentAppGeneratorError):
        AgentAppExecutionRepository(sessions).version(**params)
