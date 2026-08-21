import json
from contextlib import nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, call

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidationError
from models.account import Account
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentHomeSnapshot,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkspaceOwnerType,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import (
    DeclaredArrayItem,
    DeclaredOutputChildConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
)
from models.enums import AppStatus, ConversationFromSource, ConversationStatus
from models.model import App, AppMode, Conversation, IconType, Message
from models.workflow import Workflow, WorkflowType
from services.agent import composer_service, roster_service
from services.agent.agent_soul_state import agent_soul_has_model
from services.agent.composer_service import AgentComposerService
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import (
    AgentBuildSandboxNotFoundError,
    AgentModelNotConfiguredError,
    AgentNameConflictError,
    AgentNotFoundError,
    AgentVersionConflictError,
    AgentVersionNotFoundError,
    InvalidComposerConfigError,
)
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.roster_service import AgentRosterService
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.agent.workspace_service import AgentWorkspaceService
from services.app_service import AppListParams, AppService
from services.entities.agent_entities import (
    AgentSoulConfig,
    ComposerSavePayload,
    ComposerSaveStrategy,
    ComposerVariant,
)


def _agent_soul_with_model() -> AgentSoulConfig:
    return AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai/openai",
                "model_provider": "openai",
                "model": "gpt-4o",
            }
        }
    )


def _agent(
    *,
    agent_id: str = "agent-1",
    tenant_id: str = "tenant-1",
    name: str = "Researcher",
    scope: AgentScope = AgentScope.ROSTER,
    source: AgentSource = AgentSource.ROSTER,
    app_id: str | None = None,
) -> Agent:
    return Agent(
        id=agent_id,
        tenant_id=tenant_id,
        name=name,
        description="desc",
        role="assistant",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=scope,
        source=source,
        app_id=app_id,
        status=AgentStatus.ACTIVE,
        created_by="account-1",
        updated_by="account-1",
    )


def _snapshot(
    *,
    snapshot_id: str = "snapshot-1",
    tenant_id: str = "tenant-1",
    agent_id: str = "agent-1",
    version: int = 1,
    agent_soul: AgentSoulConfig | None = None,
) -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        version=version,
        config_snapshot=agent_soul or _agent_soul_with_model(),
        created_by="account-1",
    )


def _conversation(*, conversation_id: str = "conversation-1", account_id: str = "account-1") -> Conversation:
    return Conversation(
        id=conversation_id,
        app_id="app-1",
        override_model_configs="{}",
        mode=AppMode.AGENT_CHAT,
        name="Debug",
        summary="",
        _inputs={},
        introduction="",
        system_instruction="",
        status=ConversationStatus.NORMAL,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account_id,
        dialogue_count=0,
    )


def _workflow(*, workflow_id: str = "workflow-1", tenant_id: str = "tenant-1", app_id: str = "app-1") -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph='{"nodes": [], "edges": []}',
        _features="{}",
        created_by="account-1",
        _environment_variables="{}",
        _conversation_variables="{}",
        _rag_pipeline_variables="{}",
    )


def _app(
    *,
    app_id: str = "app-1",
    tenant_id: str = "tenant-1",
    name: str = "Agent App",
    mode: AppMode = AppMode.AGENT_CHAT,
) -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name=name,
        description="",
        mode=mode,
        icon_type=IconType.EMOJI,
        icon="🤖",
        icon_background="#fff",
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=True,
        max_active_requests=None,
        created_by="account-1",
    )


def test_agent_soul_has_model():
    assert agent_soul_has_model(_agent_soul_with_model()) is True
    assert agent_soul_has_model(AgentSoulConfig()) is False


def test_get_published_agent_soul_for_app_uses_active_snapshot(sqlite_session: Session):
    agent_soul = AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": True}}})
    session = sqlite_session
    agent = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
    version = _snapshot(snapshot_id="version-1", agent_soul=agent_soul)
    agent.active_config_snapshot_id = version.id
    session.add_all([agent, version])
    session.commit()

    result = AgentRosterService(session).get_published_agent_soul_for_app(tenant_id="tenant-1", app_id="app-1")

    assert result == agent_soul


def test_get_published_agent_soul_for_app_returns_none_without_backing_agent(sqlite_session: Session):
    service = AgentRosterService(sqlite_session)

    result = service.get_published_agent_soul_for_app(tenant_id="tenant-1", app_id="legacy-app-1")

    assert result is None


def test_peek_authz_app_id_uses_the_parent_app_not_the_hidden_backing_app(sqlite_session: Session):
    """A workflow-only Agent is authorized against its parent workflow App."""
    session = sqlite_session
    agent = _agent(
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        app_id="parent-app-1",
    )
    agent.backing_app_id = "backing-app-1"
    agent.workflow_id = "workflow-1"
    agent.workflow_node_id = "node-1"
    session.add(agent)
    session.commit()

    result = AgentRosterService(session).peek_authz_app_id(tenant_id="tenant-1", agent_id="agent-1")

    assert result == "parent-app-1"


def test_peek_authz_app_id_uses_the_roster_agent_app(sqlite_session: Session):
    session = sqlite_session
    agent = _agent(source=AgentSource.AGENT_APP, app_id="roster-app-1")
    session.add(agent)
    session.commit()

    result = AgentRosterService(session).peek_authz_app_id(tenant_id="tenant-1", agent_id="agent-1")

    assert result == "roster-app-1"


def test_peek_authz_app_id_returns_none_without_creating_a_backing_app(sqlite_session: Session):
    """Authorization checks must not materialize the hidden backing App."""
    session = sqlite_session
    service = AgentRosterService(session)

    result = service.peek_authz_app_id(tenant_id="tenant-1", agent_id="agent-1")

    assert result is None
    assert not session.new
    assert not session.dirty


def test_load_workflow_composer_returns_empty_state(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: None)

    result = AgentComposerService.load_workflow_composer(
        session=session, tenant_id="tenant-1", app_id="app-1", node_id="node-1"
    )

    assert result["binding"] is None
    assert result["save_options"] == ["node_job_only", "save_to_roster"]
    assert result["workflow_id"] == "workflow-1"
    effective = result["effective_declared_outputs"]
    assert [o["name"] for o in effective] == ["text"]
    assert effective[0]["required"] is False


def test_load_workflow_composer_serializes_existing_binding(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    binding = SimpleNamespace(
        agent_id="agent-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        current_snapshot_id="version-1",
    )
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: binding)
    monkeypatch.setattr(
        AgentComposerService,
        "_get_agent_if_present",
        lambda **kwargs: SimpleNamespace(id="agent-1", active_config_snapshot_id="version-1"),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_get_version_if_present",
        lambda **kwargs: SimpleNamespace(id="version-1"),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_serialize_workflow_state",
        lambda **kwargs: {"agent": kwargs["agent"].id, "version": kwargs["version"].id},
    )

    result = AgentComposerService.load_workflow_composer(
        session=session, tenant_id="tenant-1", app_id="app-1", node_id="node-1"
    )

    assert result == {"agent": "agent-1", "version": "version-1"}


def test_load_workflow_composer_uses_roster_preview_snapshot(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    binding = SimpleNamespace(
        agent_id="agent-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        current_snapshot_id="binding-version",
    )
    agent = SimpleNamespace(id="agent-1", scope=AgentScope.ROSTER, active_config_snapshot_id="active-version")

    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: binding)
    monkeypatch.setattr(AgentComposerService, "_get_agent_if_present", lambda **kwargs: agent)
    monkeypatch.setattr(
        AgentComposerService,
        "_require_version",
        lambda **kwargs: SimpleNamespace(id=kwargs["version_id"]),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_serialize_workflow_state",
        lambda **kwargs: {
            "binding_snapshot_id": kwargs["binding"].current_snapshot_id,
            "version": kwargs["version"].id,
        },
    )

    result = AgentComposerService.load_workflow_composer(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node-1",
        snapshot_id="preview-version",
    )

    assert result == {"binding_snapshot_id": "binding-version", "version": "preview-version"}


def test_load_workflow_composer_uses_inline_preview_snapshot(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    binding = SimpleNamespace(
        agent_id="inline-agent-1",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        current_snapshot_id="inline-version-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-1",
    )
    agent = SimpleNamespace(
        id="inline-agent-1",
        scope=AgentScope.WORKFLOW_ONLY,
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_node_id="node-1",
        active_config_snapshot_id="inline-version-1",
    )

    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: binding)
    monkeypatch.setattr(AgentComposerService, "_get_agent_if_present", lambda **kwargs: agent)
    monkeypatch.setattr(
        AgentComposerService,
        "_require_version",
        lambda **kwargs: SimpleNamespace(id=kwargs["version_id"]),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_serialize_workflow_state",
        lambda **kwargs: {"agent": kwargs["agent"].id, "version": kwargs["version"].id},
    )

    result = AgentComposerService.load_workflow_composer(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node-1",
        snapshot_id="inline-preview-version",
    )

    assert result == {"agent": "inline-agent-1", "version": "inline-preview-version"}


def test_workflow_inline_debug_conversation_seed(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    captured: dict[str, object] = {}

    class FakeRosterService:
        def __init__(self, session):
            captured["session"] = session

        def get_or_create_build_conversation(self, **kwargs):
            captured.update(kwargs)
            return "debug-conversation-1"

    monkeypatch.setattr(roster_service, "AgentRosterService", FakeRosterService)

    binding = SimpleNamespace(binding_type=WorkflowAgentBindingType.INLINE_AGENT)
    agent = SimpleNamespace(id="inline-agent-1", scope=AgentScope.WORKFLOW_ONLY)

    debug_conversation_id = AgentComposerService._workflow_inline_debug_conversation_id(
        session=session,
        tenant_id="tenant-1",
        binding=binding,
        agent=agent,
        account_id="account-1",
    )

    assert debug_conversation_id == "debug-conversation-1"
    assert captured["tenant_id"] == "tenant-1"
    assert captured["agent_id"] == "inline-agent-1"
    assert captured["account_id"] == "account-1"
    assert captured["commit"] is False


def test_workflow_inline_debug_conversation_seed_skips_non_inline(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session

    class UnexpectedRosterService:
        def __init__(self, session):
            raise AssertionError("roster service should not be used")

    monkeypatch.setattr(roster_service, "AgentRosterService", UnexpectedRosterService)

    assert (
        AgentComposerService._workflow_inline_debug_conversation_id(
            session=session,
            tenant_id="tenant-1",
            binding=SimpleNamespace(binding_type=WorkflowAgentBindingType.ROSTER_AGENT),
            agent=SimpleNamespace(id="agent-1", scope=AgentScope.ROSTER),
            account_id="account-1",
        )
        is None
    )
    assert (
        AgentComposerService._workflow_inline_debug_conversation_id(
            session=session,
            tenant_id="tenant-1",
            binding=SimpleNamespace(binding_type=WorkflowAgentBindingType.INLINE_AGENT),
            agent=SimpleNamespace(id="inline-agent-1", scope=AgentScope.WORKFLOW_ONLY),
            account_id=None,
        )
        is None
    )


def test_load_workflow_composer_rejects_preview_without_binding(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: None)

    with pytest.raises(AgentVersionNotFoundError):
        AgentComposerService.load_workflow_composer(
            session=session,
            tenant_id="tenant-1",
            app_id="app-1",
            node_id="node-1",
            snapshot_id="preview-version",
        )


@pytest.mark.parametrize(
    ("strategy", "helper_name"),
    [
        (ComposerSaveStrategy.NODE_JOB_ONLY, "_save_node_job_only"),
        (ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION, "_save_to_current_version"),
        (ComposerSaveStrategy.SAVE_AS_NEW_VERSION, "_save_as_new_version"),
        (ComposerSaveStrategy.SAVE_AS_NEW_AGENT, "_save_as_new_agent"),
        (ComposerSaveStrategy.SAVE_TO_ROSTER, "_save_to_roster"),
    ],
)
def test_save_workflow_composer_dispatches_save_strategy(monkeypatch, strategy, helper_name, sqlite_session: Session):
    session = sqlite_session
    binding = SimpleNamespace(
        agent_id="agent-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        current_snapshot_id="version-1",
    )
    calls = []
    serialize_calls = []

    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_draft_save_payload", lambda payload: None)
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: None)
    monkeypatch.setattr(
        AgentComposerService,
        "_get_agent_if_present",
        lambda **kwargs: SimpleNamespace(id="agent-1", active_config_snapshot_id="version-1"),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_get_version_if_present",
        lambda **kwargs: SimpleNamespace(id="version-1"),
    )

    def serialize_workflow_state(**kwargs):
        serialize_calls.append(kwargs)
        return {"state": "ok"}

    monkeypatch.setattr(AgentComposerService, "_serialize_workflow_state", serialize_workflow_state)

    def save_helper(**kwargs):
        calls.append(kwargs)
        return binding

    monkeypatch.setattr(AgentComposerService, helper_name, save_helper)
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW.value,
            "save_strategy": strategy.value,
            "agent_soul": {"prompt": {"system_prompt": "x"}},
        }
    )

    result = AgentComposerService.save_workflow_composer(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node-1",
        account_id="account-1",
        payload=payload,
    )

    assert result.pop("validation") == {"warnings": [], "knowledge_retrieval_placeholder": []}
    assert result == {"state": "ok"}
    assert calls
    assert serialize_calls[0]["account_id"] == "account-1"


def test_save_workflow_composer_commits_before_retiring_replaced_inline_agent(
    monkeypatch, sqlite_session: Session
) -> None:
    session = sqlite_session
    events: list[str] = []
    old_binding = SimpleNamespace(
        agent_id="old-inline-agent",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
    )
    new_binding = SimpleNamespace(
        agent_id="new-agent",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        current_snapshot_id="version-1",
    )
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **_kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **_kwargs: old_binding)
    monkeypatch.setattr(AgentComposerService, "_save_as_new_agent", lambda **_kwargs: new_binding)
    monkeypatch.setattr(
        AgentComposerService,
        "_get_agent_if_present",
        lambda **_kwargs: SimpleNamespace(id="new-agent", active_config_snapshot_id="version-1"),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_get_version_if_present",
        lambda **_kwargs: SimpleNamespace(id="version-1"),
    )
    monkeypatch.setattr(AgentComposerService, "_serialize_workflow_state", lambda **_kwargs: {"state": "ok"})
    monkeypatch.setattr(AgentComposerService, "validate_knowledge_datasets", lambda **_kwargs: None)
    monkeypatch.setattr(AgentComposerService, "collect_validation_findings", lambda **_kwargs: {})
    event.listen(session, "after_commit", lambda _session: events.append("commit"))

    def retire_unowned(**kwargs):
        assert kwargs["agent_ids"] == {"old-inline-agent"}
        events.append("retire")

    monkeypatch.setattr(composer_service.WorkflowAgentRetirementService, "retire_unowned", retire_unowned)
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW,
            "save_strategy": ComposerSaveStrategy.SAVE_AS_NEW_AGENT,
            "agent_soul": _agent_soul_with_model().model_dump(mode="json"),
            "new_agent_name": "New Agent",
            "soul_lock": {"locked": False},
        }
    )

    AgentComposerService.save_workflow_composer(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node-1",
        account_id="account-1",
        payload=payload,
    )

    assert events == ["commit", "retire"]


def test_save_workflow_composer_rejects_agent_app_variant(sqlite_session: Session):
    session = sqlite_session
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.AGENT_APP.value,
            "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
            "agent_soul": {"prompt": {"system_prompt": "x"}},
        }
    )

    with pytest.raises(ValueError):
        AgentComposerService.save_workflow_composer(
            session=session,
            tenant_id="tenant-1",
            app_id="app-1",
            node_id="node-1",
            account_id="account-1",
            payload=payload,
        )


def _duplicate_env_secret_payload(strategy: ComposerSaveStrategy) -> ComposerSavePayload:
    return ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.AGENT_APP.value,
            "save_strategy": strategy.value,
            "agent_soul": {
                "prompt": {"system_prompt": "x"},
                "env": {
                    "variables": [{"name": "TOKEN", "value": "plain"}],
                    "secret_refs": [{"name": "TOKEN", "value": "credential-1"}],
                },
            },
        }
    )


@pytest.mark.parametrize(
    "strategy",
    [
        ComposerSaveStrategy.NODE_JOB_ONLY,
        ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION,
    ],
)
def test_draft_save_strategies_skip_publish_validation(strategy: ComposerSaveStrategy):
    composer_service._validate_composer_payload_for_strategy(_duplicate_env_secret_payload(strategy))


@pytest.mark.parametrize(
    "strategy",
    [
        ComposerSaveStrategy.SAVE_AS_NEW_VERSION,
        ComposerSaveStrategy.SAVE_AS_NEW_AGENT,
        ComposerSaveStrategy.SAVE_TO_ROSTER,
    ],
)
def test_publish_save_strategies_run_publish_validation(strategy: ComposerSaveStrategy):
    with pytest.raises(InvalidComposerConfigError, match="duplicate env/secret name 'TOKEN'"):
        composer_service._validate_composer_payload_for_strategy(_duplicate_env_secret_payload(strategy))


def test_save_agent_app_composer_creates_agent_when_missing(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    saved_draft = SimpleNamespace(
        id="draft-1",
        home_snapshot_id="home-initial",
        config_snapshot_dict={"prompt": {"system_prompt": "x"}},
    )

    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_draft_save_payload", lambda payload: None)
    monkeypatch.setattr(AgentComposerService, "_save_agent_draft", lambda **kwargs: saved_draft)
    monkeypatch.setattr(AgentComposerService, "load_agent_composer", lambda **kwargs: {"loaded": True})
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.AGENT_APP.value,
            "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
            "new_agent_name": "Analyst",
            "agent_soul": {"prompt": {"system_prompt": "x"}},
        }
    )

    result = AgentComposerService.save_agent_app_composer(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        account_id="account-1",
        payload=payload,
    )

    assert result.pop("validation") == {"warnings": [], "knowledge_retrieval_placeholder": []}
    assert result == {"loaded": True}
    agent = session.scalar(select(Agent).where(Agent.app_id == "app-1"))
    assert agent is not None
    snapshot = session.scalar(select(AgentConfigSnapshot).where(AgentConfigSnapshot.agent_id == agent.id))
    assert snapshot is not None
    assert agent.name == "Analyst"
    assert agent.active_config_snapshot_id == snapshot.id
    assert snapshot.home_snapshot_id is None
    assert agent.active_config_is_published is False


def test_load_agent_app_composer_exposes_draft_save_only(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    agent = SimpleNamespace(
        id="agent-1",
        active_config_snapshot_id="version-1",
        active_config_is_published=True,
        updated_by="account-1",
        created_by="account-1",
        app_id="app-1",
        backing_app_id="app-1",
        scope=AgentScope.ROSTER,
        status=AgentStatus.ACTIVE,
    )
    draft = SimpleNamespace(config_snapshot_dict={"prompt": {"system_prompt": "x"}})

    monkeypatch.setattr(AgentComposerService, "_require_agent_app_agent", lambda **kwargs: agent)
    monkeypatch.setattr(AgentComposerService, "_get_or_create_agent_draft", lambda **kwargs: draft)
    monkeypatch.setattr(AgentComposerService, "_get_version_if_present", lambda **kwargs: None)
    monkeypatch.setattr(AgentComposerService, "_serialize_agent", lambda _agent: {"id": _agent.id})
    monkeypatch.setattr(AgentComposerService, "_serialize_version", lambda _version: None)
    monkeypatch.setattr(AgentComposerService, "_serialize_draft", lambda _draft: {"id": "draft-1"})

    result = AgentComposerService.load_agent_app_composer(session=session, tenant_id="tenant-1", app_id="app-1")

    assert result["save_options"] == [ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value]
    assert result["active_config_is_published"] is True


def test_save_agent_app_composer_rejects_version_save_strategy(sqlite_session: Session):
    session = sqlite_session
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.AGENT_APP.value,
            "save_strategy": ComposerSaveStrategy.SAVE_AS_NEW_VERSION.value,
            "agent_soul": {"prompt": {"system_prompt": "x"}},
        }
    )

    with pytest.raises(InvalidComposerConfigError, match="Use the publish endpoint"):
        AgentComposerService.save_agent_app_composer(
            session=session,
            tenant_id="tenant-1",
            app_id="app-1",
            account_id="account-1",
            payload=payload,
        )


def test_save_agent_app_composer_updates_normal_draft(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    agent = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
    agent.active_config_snapshot_id = "version-1"
    agent.active_config_is_published = True
    agent.updated_by = None
    session.add(agent)
    session.commit()
    active_version = SimpleNamespace(
        home_snapshot_id="home-initial", config_snapshot_dict=AgentSoulConfig().model_dump(mode="json")
    )
    saved = {}

    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_draft_save_payload", lambda payload: None)
    monkeypatch.setattr(
        AgentComposerService,
        "_save_agent_draft",
        lambda **kwargs: saved.update(kwargs) or SimpleNamespace(id="draft-1", home_snapshot_id="home-initial"),
    )
    monkeypatch.setattr(AgentComposerService, "_get_version_if_present", lambda **_kwargs: active_version)
    monkeypatch.setattr(
        AgentComposerService,
        "load_agent_composer",
        lambda **kwargs: {"loaded": True, "active_config_is_published": agent.active_config_is_published},
    )
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.AGENT_APP.value,
            "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
            "agent_soul": _agent_soul_with_model().model_dump(mode="json"),
        }
    )

    result = AgentComposerService.save_agent_app_composer(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        account_id="account-1",
        payload=payload,
    )

    assert result.pop("validation") == {"warnings": [], "knowledge_retrieval_placeholder": []}
    assert result == {"loaded": True, "active_config_is_published": False}
    assert saved["draft_type"] == AgentConfigDraftType.DRAFT
    assert saved["agent_soul"].model_dump(mode="json") == _agent_soul_with_model().model_dump(mode="json")
    assert agent.active_config_is_published is False


def test_save_agent_app_composer_keeps_published_when_draft_matches_active_snapshot(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    agent_soul = _agent_soul_with_model()
    session = sqlite_session
    agent = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
    agent.active_config_snapshot_id = "version-1"
    agent.active_config_is_published = False
    agent.updated_by = None
    revision = AgentConfigRevision(
        tenant_id="tenant-1",
        agent_id=agent.id,
        current_snapshot_id="version-1",
        revision=1,
        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
    )
    session.add_all([agent, revision])
    session.commit()
    active_version = SimpleNamespace(
        home_snapshot_id="home-initial", config_snapshot_dict=agent_soul.model_dump(mode="json")
    )

    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_draft_save_payload", lambda payload: None)
    monkeypatch.setattr(
        AgentComposerService,
        "_save_agent_draft",
        lambda **_kwargs: SimpleNamespace(id="draft-1", home_snapshot_id="home-initial"),
    )
    monkeypatch.setattr(AgentComposerService, "_get_version_if_present", lambda **_kwargs: active_version)
    monkeypatch.setattr(
        AgentComposerService,
        "load_agent_composer",
        lambda **_kwargs: {"loaded": True, "active_config_is_published": agent.active_config_is_published},
    )
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.AGENT_APP.value,
            "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
            "agent_soul": agent_soul.model_dump(mode="json"),
        }
    )

    result = AgentComposerService.save_agent_app_composer(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        account_id="account-1",
        payload=payload,
    )

    assert agent.active_config_is_published is True
    assert result["active_config_is_published"] is True


def test_publish_agent_app_draft_rejects_missing_model(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id="app-1",
        active_config_snapshot_id="version-1",
        active_config_is_published=False,
    )
    draft = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        base_snapshot_id="version-1",
        config_snapshot=AgentSoulConfig(),
    )
    session.add_all([agent, draft])
    session.commit()

    def fail_create_config_version(**_kwargs):
        raise AssertionError("config version must not be created when Agent Soul has no model")

    def fail_validate_knowledge_datasets(**_kwargs):
        raise AssertionError("knowledge datasets must not be validated when Agent Soul has no model")

    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_publish_payload", lambda payload: None)
    monkeypatch.setattr(composer_service, "agent_has_workflow_callable_active_snapshot", lambda **_kwargs: False)
    monkeypatch.setattr(AgentComposerService, "validate_knowledge_datasets", fail_validate_knowledge_datasets)
    monkeypatch.setattr(AgentComposerService, "_create_config_version", fail_create_config_version)

    with pytest.raises(AgentModelNotConfiguredError) as exc_info:
        AgentComposerService.publish_agent_app_draft(
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="account-1",
            version_note="ship it",
            session=session,
        )

    assert exc_info.value.error_code == "agent_model_not_configured"
    assert agent.active_config_snapshot_id == "version-1"
    assert agent.active_config_is_published is False
    assert draft.base_snapshot_id == "version-1"
    assert not session.new
    assert not session.dirty


def test_publish_agent_app_draft_creates_published_snapshot(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id="app-1",
        active_config_snapshot_id="version-1",
    )
    draft = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        base_snapshot_id="version-1",
        home_snapshot_id=None,
        config_snapshot=_agent_soul_with_model(),
    )
    version = SimpleNamespace(id="version-2")
    app = _app(mode=AppMode.AGENT)
    app.enable_site = False
    app.enable_api = False
    session.add_all([agent, draft, app])
    session.commit()
    created: dict[str, object] = {}
    calls: list[str] = []
    register_publish_event = MagicMock()

    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_publish_payload", lambda payload: None)
    monkeypatch.setattr(composer_service, "agent_has_workflow_callable_active_snapshot", lambda **_kwargs: False)
    monkeypatch.setattr(AgentComposerService, "validate_knowledge_datasets", lambda **kwargs: None)
    monkeypatch.setattr(
        composer_service,
        "validate_home_snapshot_binding",
        lambda **kwargs: calls.append("validate_home"),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_create_config_version",
        lambda **kwargs: calls.append("create_version") or created.update(kwargs) or version,
    )
    monkeypatch.setattr(AgentComposerService, "_serialize_version", lambda _version: {"id": _version.id})
    monkeypatch.setattr(composer_service, "register_new_agent_beta_publish_after_commit", register_publish_event)

    result = AgentComposerService.publish_agent_app_draft(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
        version_note="ship it",
    )

    assert result["result"] == "success"
    assert result["active_config_snapshot_id"] == "version-2"
    assert result["draft"]["base_snapshot_id"] == "version-2"
    assert created["operation"] == AgentConfigRevisionOperation.PUBLISH_DRAFT
    assert created["previous_snapshot_id"] == "version-1"
    assert created["home_snapshot_id"] is None
    assert calls == ["validate_home", "create_version"]
    assert agent.active_config_snapshot_id == "version-2"
    assert agent.active_config_has_model is True
    assert agent.active_config_is_published is True
    assert app.enable_site is True
    assert app.enable_api is True
    assert app.updated_by == "account-1"
    register_publish_event.assert_called_once_with(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        snapshot_id="version-2",
    )


def test_repeated_publish_reuses_normal_draft_home_without_creating_resources(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id="app-1",
        active_config_snapshot_id="version-1",
    )
    draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        home_snapshot_id="home-1",
        config_snapshot=_agent_soul_with_model(),
    )
    app = _app(mode=AppMode.AGENT)
    app.enable_site = False
    app.enable_api = False
    session.add_all([agent, draft, app])
    session.commit()
    published_homes: list[str] = []
    versions = iter([SimpleNamespace(id="version-2"), SimpleNamespace(id="version-3")])
    create_from_build = MagicMock()
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_publish_payload", lambda _payload: None)
    publish_visibility = iter([False, True])
    monkeypatch.setattr(
        composer_service,
        "agent_has_workflow_callable_active_snapshot",
        lambda **_kwargs: next(publish_visibility),
    )
    monkeypatch.setattr(AgentComposerService, "validate_knowledge_datasets", lambda **_kwargs: None)
    monkeypatch.setattr(composer_service, "validate_home_snapshot_binding", lambda **_kwargs: None)
    monkeypatch.setattr(
        AgentComposerService,
        "_create_config_version",
        lambda **kwargs: published_homes.append(kwargs["home_snapshot_id"]) or next(versions),
    )
    monkeypatch.setattr(AgentComposerService, "_serialize_version", lambda version: {"id": version.id})
    monkeypatch.setattr(AgentComposerService, "_serialize_draft", lambda value: {"id": value.id})
    monkeypatch.setattr(AgentHomeSnapshotService, "create_for_build_apply", create_from_build)

    first = AgentComposerService.publish_agent_app_draft(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )
    app.enable_site = False
    app.enable_api = False
    second = AgentComposerService.publish_agent_app_draft(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )

    assert first["active_config_snapshot_id"] == "version-2"
    assert second["active_config_snapshot_id"] == "version-3"
    assert published_homes == ["home-1", "home-1"]
    assert draft.home_snapshot_id == "home-1"
    assert app.enable_site is False
    assert app.enable_api is False
    create_from_build.assert_not_called()


def test_agent_app_build_draft_checkout_and_apply_use_user_isolated_draft(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="version-1",
        active_config_is_published=True,
    )
    normal_draft = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        base_snapshot_id="version-1",
        home_snapshot_id="home-initial",
        config_snapshot=_agent_soul_with_model(),
    )
    active_version = AgentConfigSnapshot(
        id="version-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        version=1,
        home_snapshot_id=normal_draft.home_snapshot_id,
        config_snapshot=normal_draft.config_snapshot,
    )
    publish_revision = AgentConfigRevision(
        tenant_id="tenant-1",
        agent_id=agent.id,
        current_snapshot_id=active_version.id,
        revision=1,
        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
    )
    session.add_all([agent, normal_draft, active_version, publish_revision])
    session.commit()

    checked_out = AgentComposerService.checkout_agent_app_build_draft(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )

    build_draft = session.scalar(
        select(AgentConfigDraft).where(
            AgentConfigDraft.agent_id == agent.id,
            AgentConfigDraft.draft_type == AgentConfigDraftType.DEBUG_BUILD,
            AgentConfigDraft.account_id == "account-1",
        )
    )
    assert build_draft is not None
    assert checked_out["draft"]["id"] == build_draft.id
    assert checked_out["draft"]["draft_type"] == AgentConfigDraftType.DEBUG_BUILD.value
    assert checked_out["draft"]["account_id"] == "account-1"
    assert checked_out["draft"]["base_snapshot_id"] == "version-1"
    assert build_draft.home_snapshot_id == "home-initial"
    assert checked_out["agent_soul"] == normal_draft.config_snapshot_dict

    source_binding_id = "binding-1"
    build_draft.agent_workspace_binding_id = source_binding_id
    session.commit()
    create_home = MagicMock(return_value=SimpleNamespace(id="home-build", snapshot_ref="backend-home-build"))
    monkeypatch.setattr(AgentHomeSnapshotService, "create_for_build_apply", create_home)
    retire_binding = MagicMock()
    enqueue_collection = MagicMock()
    monkeypatch.setattr(AgentWorkspaceService, "retire_binding", retire_binding)
    monkeypatch.setattr(composer_service, "enqueue_agent_resource_collection", enqueue_collection)

    applied = AgentComposerService.apply_agent_app_build_draft(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )

    assert applied["result"] == "success"
    assert applied["draft"]["id"] == normal_draft.id
    assert normal_draft.config_snapshot_dict == build_draft.config_snapshot_dict
    assert normal_draft.home_snapshot_id == "home-build"
    assert agent.active_config_is_published is False
    assert session.get(AgentConfigDraft, build_draft.id) is None
    create_home.assert_called_once_with(
        session=session,
        build_draft=build_draft,
    )
    retire_binding.assert_called_once_with(session=session, tenant_id="tenant-1", binding_id=source_binding_id)
    enqueue_collection.assert_called_once_with(tenant_id="tenant-1", binding_ids=[source_binding_id])


@pytest.mark.parametrize(
    ("scope", "source", "app_id", "backing_app_id", "expected_runtime_app_id"),
    [
        (AgentScope.ROSTER, AgentSource.AGENT_APP, "app-1", None, "app-1"),
        (
            AgentScope.WORKFLOW_ONLY,
            AgentSource.WORKFLOW,
            "workflow-app-1",
            "runtime-app-1",
            "runtime-app-1",
        ),
    ],
)
def test_force_build_draft_checkout_collects_retired_binding_after_commit(
    monkeypatch: pytest.MonkeyPatch,
    scope: AgentScope,
    source: AgentSource,
    app_id: str,
    backing_app_id: str | None,
    expected_runtime_app_id: str,
    sqlite_session: Session,
) -> None:
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=scope,
        source=source,
        status=AgentStatus.ACTIVE,
        app_id=app_id,
        backing_app_id=backing_app_id,
    )
    normal_draft = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        home_snapshot_id="home-1",
        config_snapshot=_agent_soul_with_model(),
    )
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-1",
        agent_workspace_binding_id="binding-1",
        config_snapshot=_agent_soul_with_model(),
    )
    binding = SimpleNamespace(
        agent_id=agent.id,
        base_home_snapshot_id="home-1",
        agent_config_version_id=build_draft.id,
        agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
    )
    get_active_binding = MagicMock(return_value=binding)
    retire_binding = MagicMock(return_value="binding-1")
    enqueue_collection = MagicMock()
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active_binding)
    monkeypatch.setattr(AgentWorkspaceService, "retire_binding", retire_binding)
    monkeypatch.setattr(composer_service, "enqueue_agent_resource_collection", enqueue_collection)
    session.add_all([agent, normal_draft, build_draft])
    session.commit()

    AgentComposerService.checkout_agent_app_build_draft(
        session=session,
        tenant_id="tenant-1",
        agent_id=agent.id,
        account_id="account-1",
    )

    assert build_draft.agent_workspace_binding_id == "binding-1"
    retire_binding.assert_not_called()
    enqueue_collection.assert_not_called()

    AgentComposerService.checkout_agent_app_build_draft(
        session=session,
        tenant_id="tenant-1",
        agent_id=agent.id,
        account_id="account-1",
        force=True,
    )

    assert build_draft.agent_workspace_binding_id is None
    owner_scope = get_active_binding.call_args.kwargs["expected_owner_scope"]
    assert owner_scope.app_id == expected_runtime_app_id
    assert owner_scope.owner_type is AgentWorkspaceOwnerType.BUILD_DRAFT
    assert owner_scope.owner_id == build_draft.id
    retire_binding.assert_called_once_with(
        session=session,
        tenant_id="tenant-1",
        binding_id="binding-1",
    )
    enqueue_collection.assert_called_once_with(
        tenant_id="tenant-1",
        binding_ids=("binding-1",),
    )


def test_force_build_draft_checkout_rejects_unavailable_pointed_binding(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id="app-1",
    )
    normal_draft = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        home_snapshot_id="home-1",
        config_snapshot=_agent_soul_with_model(),
    )
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-1",
        agent_workspace_binding_id="binding-missing",
        config_snapshot=_agent_soul_with_model(),
    )
    session.add_all([agent, normal_draft, build_draft])
    session.commit()
    retire_binding = MagicMock()
    enqueue_collection = MagicMock()
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=None))
    monkeypatch.setattr(AgentWorkspaceService, "retire_binding", retire_binding)
    monkeypatch.setattr(composer_service, "enqueue_agent_resource_collection", enqueue_collection)

    with pytest.raises(AgentBuildSandboxNotFoundError):
        AgentComposerService.checkout_agent_app_build_draft(
            session=session,
            tenant_id="tenant-1",
            agent_id=agent.id,
            account_id="account-1",
            force=True,
        )

    assert build_draft.agent_workspace_binding_id == "binding-missing"
    assert session.get(AgentConfigDraft, build_draft.id).agent_workspace_binding_id == "binding-missing"
    retire_binding.assert_not_called()
    enqueue_collection.assert_not_called()


def test_build_apply_checkpoints_binding_updates_normal_draft_then_collects(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id="app-1",
    )
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id=None,
        agent_workspace_binding_id="binding-1",
        config_snapshot=AgentSoulConfig(),
    )
    normal_draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        home_snapshot_id=None,
        config_snapshot=AgentSoulConfig(),
    )
    source_binding = SimpleNamespace(
        id="binding-1",
        backend_binding_ref="backend-binding-1",
        agent_id="agent-1",
        base_home_snapshot_id=None,
        agent_config_version_id="build-1",
        agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
    )
    session.add_all([agent, build_draft])
    session.commit()
    client = MagicMock()
    client.create_home_snapshot_from_binding_sync.return_value = SimpleNamespace(snapshot_ref="snapshot-ref-new")
    lifecycle: list[str] = []
    event.listen(session, "after_commit", lambda _session: lifecycle.append("commit"))
    retire = MagicMock(return_value=source_binding.id)
    enqueue_collection = MagicMock(side_effect=lambda **_kwargs: lifecycle.append("enqueue"))
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_publish_payload", lambda _payload: None)
    monkeypatch.setattr(AgentComposerService, "validate_knowledge_datasets", lambda **_kwargs: None)
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=source_binding))
    monkeypatch.setattr(AgentComposerService, "_save_agent_draft", lambda **_kwargs: normal_draft)
    monkeypatch.setattr(AgentComposerService, "_agent_soul_matches_active_config", lambda **_kwargs: False)
    monkeypatch.setattr(AgentComposerService, "_serialize_draft", lambda draft: {"id": draft.id})
    monkeypatch.setattr(AgentWorkspaceService, "retire_binding", retire)
    monkeypatch.setattr(composer_service, "enqueue_agent_resource_collection", enqueue_collection)

    result = AgentComposerService.apply_agent_app_build_draft(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )

    request = client.create_home_snapshot_from_binding_sync.call_args.args[0]
    assert request.backend_binding_ref == "backend-binding-1"
    created_home = session.scalar(select(AgentHomeSnapshot).where(AgentHomeSnapshot.snapshot_ref == "snapshot-ref-new"))
    assert created_home is not None
    assert created_home.snapshot_ref == "snapshot-ref-new"
    assert normal_draft.home_snapshot_id == created_home.id
    retire.assert_called_once_with(session=session, tenant_id="tenant-1", binding_id="binding-1")
    enqueue_collection.assert_called_once_with(tenant_id="tenant-1", binding_ids=["binding-1"])
    assert lifecycle == ["commit", "enqueue"]
    assert result == {"result": "success", "draft": {"id": "draft-1"}}


def test_build_apply_retires_normal_preview_binding_before_replacing_draft_home(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id="app-1",
    )
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-build",
        agent_workspace_binding_id="binding-build",
        config_snapshot=AgentSoulConfig(),
    )
    normal_draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        home_snapshot_id="home-preview-old",
        config_snapshot=AgentSoulConfig(),
    )
    preview_mapping = AgentDebugConversation(
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        app_id="app-1",
        account_id="account-2",
        draft_type=AgentConfigDraftType.DRAFT,
        conversation_id="conversation-preview",
    )
    empty_preview_mapping = AgentDebugConversation(
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        app_id="app-1",
        account_id="account-3",
        draft_type=AgentConfigDraftType.DRAFT,
        conversation_id="conversation-preview-empty",
    )
    preview_conversation = _conversation(conversation_id="conversation-preview", account_id="account-2")
    preview_conversation.agent_workspace_binding_id = "binding-preview"
    empty_preview_conversation = _conversation(conversation_id="conversation-preview-empty", account_id="account-3")
    preview_binding = SimpleNamespace(
        id="binding-preview",
        agent_id=agent.id,
        base_home_snapshot_id="home-preview-old",
        agent_config_version_id=normal_draft.id,
        agent_config_version_kind=AgentConfigVersionKind.DRAFT,
    )
    session.add_all(
        [
            agent,
            build_draft,
            preview_mapping,
            empty_preview_mapping,
            preview_conversation,
            empty_preview_conversation,
        ]
    )
    session.commit()
    lifecycle: list[str] = []
    event.listen(session, "after_commit", lambda _session: lifecycle.append("commit"))
    monkeypatch.setattr(
        AgentHomeSnapshotService,
        "create_for_build_apply",
        MagicMock(return_value=SimpleNamespace(id="home-applied")),
    )
    monkeypatch.setattr(AgentComposerService, "_save_agent_draft", MagicMock(return_value=normal_draft))
    monkeypatch.setattr(AgentComposerService, "_agent_soul_matches_active_config", MagicMock(return_value=False))
    monkeypatch.setattr(AgentComposerService, "validate_knowledge_datasets", MagicMock())
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_publish_payload", MagicMock())
    get_active_binding = MagicMock(return_value=preview_binding)
    retire_binding = MagicMock(side_effect=["binding-preview", "binding-build"])
    validate_generation = MagicMock()
    enqueue_collection = MagicMock(side_effect=lambda **_kwargs: lifecycle.append("enqueue"))
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active_binding)
    monkeypatch.setattr(AgentWorkspaceService, "validate_binding_generation", validate_generation)
    monkeypatch.setattr(AgentWorkspaceService, "retire_binding", retire_binding)
    monkeypatch.setattr(composer_service, "enqueue_agent_resource_collection", enqueue_collection)

    AgentComposerService.apply_agent_app_build_draft(
        session=session,
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        account_id="account-1",
    )

    assert preview_conversation.agent_workspace_binding_id is None
    validate_generation.assert_called_once_with(
        preview_binding,
        base_home_snapshot_id="home-preview-old",
        agent_config_version_id=normal_draft.id,
        agent_config_version_kind=AgentConfigVersionKind.DRAFT,
    )
    enqueue_collection.assert_called_once_with(
        tenant_id=agent.tenant_id,
        binding_ids=["binding-preview", "binding-build"],
    )
    assert get_active_binding.call_count == 1
    assert get_active_binding.call_args.kwargs["binding_id"] == "binding-preview"
    assert retire_binding.call_args_list == [
        call(session=session, tenant_id=agent.tenant_id, binding_id="binding-preview"),
        call(session=session, tenant_id=agent.tenant_id, binding_id="binding-build"),
    ]
    assert lifecycle == ["commit", "enqueue"]


def test_build_apply_validates_before_resolving_or_snapshotting_sandbox(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-1",
        config_snapshot=_agent_soul_with_model(),
    )
    session.add_all([agent, build_draft])
    session.commit()
    validation = MagicMock(side_effect=InvalidComposerConfigError("invalid Build Draft"))
    create_home = MagicMock()
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_publish_payload", validation)
    monkeypatch.setattr(AgentHomeSnapshotService, "create_for_build_apply", create_home)

    with pytest.raises(InvalidComposerConfigError, match="invalid Build Draft"):
        AgentComposerService.apply_agent_app_build_draft(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="account-1",
        )

    validation.assert_called_once()
    create_home.assert_not_called()


def test_build_apply_without_model_snapshots_source_sandbox_and_updates_normal_draft(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-old",
        agent_workspace_binding_id="binding-1",
        config_snapshot=AgentSoulConfig(),
    )
    normal_draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        home_snapshot_id="home-old",
        config_snapshot=AgentSoulConfig(),
    )
    session.add_all([agent, build_draft])
    session.commit()
    create_home = MagicMock(return_value=SimpleNamespace(id="home-new", snapshot_ref="backend-home-new"))
    validate_knowledge = MagicMock()
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_publish_payload", lambda _payload: None)
    monkeypatch.setattr(AgentComposerService, "validate_knowledge_datasets", validate_knowledge)
    monkeypatch.setattr(AgentHomeSnapshotService, "create_for_build_apply", create_home)
    monkeypatch.setattr(AgentComposerService, "_save_agent_draft", lambda **_kwargs: normal_draft)
    monkeypatch.setattr(AgentComposerService, "_agent_soul_matches_active_config", lambda **_kwargs: False)
    monkeypatch.setattr(AgentWorkspaceService, "retire_binding", MagicMock())
    monkeypatch.setattr(composer_service, "enqueue_agent_resource_collection", MagicMock())
    monkeypatch.setattr(AgentComposerService, "_serialize_draft", lambda draft: {"id": draft.id})

    result = AgentComposerService.apply_agent_app_build_draft(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )

    create_home.assert_called_once_with(
        session=session,
        build_draft=build_draft,
    )
    validate_knowledge.assert_called_once()
    assert normal_draft.home_snapshot_id == "home-new"
    assert session.get(AgentConfigDraft, build_draft.id) is None
    assert result == {"result": "success", "draft": {"id": "draft-1"}}


def test_build_apply_requires_retained_sandbox_before_creating_home(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-old",
        config_snapshot=AgentSoulConfig(),
    )
    create_home = MagicMock()
    save_draft = MagicMock()
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_publish_payload", lambda _payload: None)
    monkeypatch.setattr(AgentComposerService, "validate_knowledge_datasets", lambda **_kwargs: None)
    monkeypatch.setattr(AgentHomeSnapshotService, "create_for_build_apply", create_home)
    monkeypatch.setattr(AgentComposerService, "_save_agent_draft", save_draft)
    session.add_all([agent, build_draft])
    session.commit()

    with pytest.raises(AgentBuildSandboxNotFoundError):
        AgentComposerService.apply_agent_app_build_draft(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="account-1",
        )

    create_home.assert_not_called()
    save_draft.assert_not_called()
    assert build_draft.home_snapshot_id == "home-old"
    assert session.get(AgentConfigDraft, build_draft.id) is not None


def test_build_apply_fails_when_locked_source_cannot_be_retired(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-old",
        agent_workspace_binding_id="binding-1",
        config_snapshot=AgentSoulConfig(),
    )
    normal_draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        home_snapshot_id="home-old",
        config_snapshot=AgentSoulConfig(),
    )
    session.add_all([agent, build_draft])
    session.commit()
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_publish_payload", lambda _payload: None)
    monkeypatch.setattr(AgentComposerService, "validate_knowledge_datasets", lambda **_kwargs: None)
    monkeypatch.setattr(
        AgentHomeSnapshotService,
        "create_for_build_apply",
        MagicMock(return_value=SimpleNamespace(id="home-new", snapshot_ref="backend-home-new")),
    )
    monkeypatch.setattr(AgentComposerService, "_save_agent_draft", MagicMock(return_value=normal_draft))
    monkeypatch.setattr(AgentComposerService, "_agent_soul_matches_active_config", lambda **_kwargs: False)
    monkeypatch.setattr(AgentWorkspaceService, "retire_binding", MagicMock(return_value=None))
    enqueue_collection = MagicMock()
    monkeypatch.setattr(composer_service, "enqueue_agent_resource_collection", enqueue_collection)

    with pytest.raises(AgentBuildSandboxNotFoundError):
        AgentComposerService.apply_agent_app_build_draft(
            session=session,
            tenant_id="tenant-1",
            agent_id=agent.id,
            account_id="account-1",
        )

    assert session.get(AgentConfigDraft, build_draft.id) is not None
    enqueue_collection.assert_not_called()


def test_build_apply_home_create_failure_leaves_drafts_untouched(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-old",
        agent_workspace_binding_id="binding-1",
        config_snapshot=AgentSoulConfig(),
    )
    normal_draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        home_snapshot_id="home-old",
        config_snapshot=AgentSoulConfig(),
    )
    save_draft = MagicMock(return_value=normal_draft)
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_publish_payload", lambda _payload: None)
    monkeypatch.setattr(AgentComposerService, "validate_knowledge_datasets", lambda **_kwargs: None)
    monkeypatch.setattr(
        AgentHomeSnapshotService,
        "create_for_build_apply",
        MagicMock(side_effect=RuntimeError("snapshot failed")),
    )
    monkeypatch.setattr(AgentComposerService, "_save_agent_draft", save_draft)
    session.add_all([agent, build_draft])
    session.commit()

    with pytest.raises(RuntimeError, match="snapshot failed"):
        AgentComposerService.apply_agent_app_build_draft(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="account-1",
        )

    save_draft.assert_not_called()
    assert build_draft.home_snapshot_id == "home-old"
    assert normal_draft.home_snapshot_id == "home-old"
    assert session.get(AgentConfigDraft, build_draft.id) is not None


def test_build_apply_commit_failure_rolls_back_and_preserves_physical_home(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-old",
        agent_workspace_binding_id="binding-1",
        config_snapshot=AgentSoulConfig(),
    )
    normal_draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        home_snapshot_id="home-old",
        config_snapshot=AgentSoulConfig(),
    )
    session.add_all([agent, build_draft])
    session.commit()

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(session, "before_commit", fail_commit)
    delete_home = MagicMock()
    monkeypatch.setattr(composer_service.ComposerConfigValidator, "validate_publish_payload", lambda _payload: None)
    monkeypatch.setattr(AgentComposerService, "validate_knowledge_datasets", lambda **_kwargs: None)
    monkeypatch.setattr(
        AgentHomeSnapshotService,
        "create_for_build_apply",
        lambda **_kwargs: SimpleNamespace(id="home-new", snapshot_ref="backend-home-new"),
    )
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", delete_home)
    monkeypatch.setattr(AgentComposerService, "_save_agent_draft", lambda **_kwargs: normal_draft)
    monkeypatch.setattr(AgentComposerService, "_agent_soul_matches_active_config", lambda **_kwargs: False)
    monkeypatch.setattr(AgentWorkspaceService, "retire_binding", MagicMock(return_value="binding-1"))
    enqueue_collection = MagicMock()
    monkeypatch.setattr(composer_service, "enqueue_agent_resource_collection", enqueue_collection)

    with pytest.raises(RuntimeError, match="commit failed"):
        AgentComposerService.apply_agent_app_build_draft(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="account-1",
        )

    assert session.get(AgentConfigDraft, build_draft.id) is not None
    delete_home.assert_not_called()
    enqueue_collection.assert_not_called()


def test_build_draft_save_and_discard_do_not_manage_home_resources(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-existing",
        config_snapshot=AgentSoulConfig(),
    )
    create_from_build = MagicMock()
    delete_home = MagicMock()
    monkeypatch.setattr(AgentHomeSnapshotService, "create_for_build_apply", create_from_build)
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", delete_home)
    monkeypatch.setattr(AgentComposerService, "_require_agent", lambda **_kwargs: agent)
    monkeypatch.setattr(AgentComposerService, "_save_agent_draft", lambda **_kwargs: build_draft)
    monkeypatch.setattr(AgentComposerService, "_serialize_build_draft_state", lambda draft: {"id": draft.id})
    save_session = sqlite_session

    AgentComposerService.save_agent_app_build_draft(
        session=save_session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
        payload=ComposerSavePayload(
            variant=ComposerVariant.AGENT_APP,
            save_strategy=ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION,
            agent_soul=AgentSoulConfig(),
        ),
    )
    discard_session = sqlite_session
    discard_session.add(build_draft)
    discard_session.commit()
    AgentComposerService.discard_agent_app_build_draft(
        session=discard_session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )

    create_from_build.assert_not_called()
    delete_home.assert_not_called()


def test_build_discard_retires_then_commits_before_enqueue(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    session = sqlite_session
    agent = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-1",
        agent_workspace_binding_id="binding-1",
        config_snapshot=AgentSoulConfig(),
    )
    binding = SimpleNamespace(
        agent_id=agent.id,
        base_home_snapshot_id="home-1",
        agent_config_version_id=build_draft.id,
        agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
    )
    session.add_all([agent, build_draft])
    session.commit()
    events: list[str] = []
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=binding))
    monkeypatch.setattr(
        AgentWorkspaceService,
        "retire_binding",
        MagicMock(side_effect=lambda **_kwargs: events.append("retire") or "binding-1"),
    )
    event.listen(session, "after_commit", lambda _session: events.append("commit"))
    monkeypatch.setattr(
        composer_service,
        "enqueue_agent_resource_collection",
        MagicMock(side_effect=lambda **_kwargs: events.append("enqueue")),
    )

    AgentComposerService.discard_agent_app_build_draft(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )

    assert events == ["retire", "commit", "enqueue"]


def test_build_discard_commit_failure_does_not_enqueue(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    session = sqlite_session
    agent = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-1",
        agent_workspace_binding_id="binding-1",
        config_snapshot=AgentSoulConfig(),
    )
    binding = SimpleNamespace(
        agent_id=agent.id,
        base_home_snapshot_id="home-1",
        agent_config_version_id=build_draft.id,
        agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
    )
    session.add_all([agent, build_draft])
    session.commit()
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=binding))
    monkeypatch.setattr(AgentWorkspaceService, "retire_binding", MagicMock(return_value="binding-1"))
    event.listen(
        session,
        "before_commit",
        lambda _session: (_ for _ in ()).throw(RuntimeError("commit failed")),
    )
    enqueue_collection = MagicMock()
    monkeypatch.setattr(composer_service, "enqueue_agent_resource_collection", enqueue_collection)

    with pytest.raises(RuntimeError, match="commit failed"):
        AgentComposerService.discard_agent_app_build_draft(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="account-1",
        )

    enqueue_collection.assert_not_called()


def test_build_discard_rejects_unavailable_pointed_binding(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    session = sqlite_session
    agent = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
    build_draft = AgentConfigDraft(
        id="build-1",
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-1",
        agent_workspace_binding_id="binding-missing",
        config_snapshot=AgentSoulConfig(),
    )
    session.add_all([agent, build_draft])
    session.commit()
    retire_binding = MagicMock()
    enqueue_collection = MagicMock()
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", MagicMock(return_value=None))
    monkeypatch.setattr(AgentWorkspaceService, "retire_binding", retire_binding)
    monkeypatch.setattr(composer_service, "enqueue_agent_resource_collection", enqueue_collection)

    with pytest.raises(AgentBuildSandboxNotFoundError):
        AgentComposerService.discard_agent_app_build_draft(
            session=session,
            tenant_id="tenant-1",
            agent_id=agent.id,
            account_id="account-1",
        )

    assert build_draft.agent_workspace_binding_id == "binding-missing"
    assert session.get(AgentConfigDraft, build_draft.id) is not None
    retire_binding.assert_not_called()
    enqueue_collection.assert_not_called()


@pytest.mark.parametrize(
    ("draft_type", "account_id"),
    [
        (AgentConfigDraftType.DRAFT, None),
        (AgentConfigDraftType.DEBUG_BUILD, "account-1"),
    ],
)
def test_load_agent_soul_for_debug_selects_requested_draft(
    draft_type: AgentConfigDraftType,
    account_id: str | None,
    sqlite_session: Session,
):
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    agent_soul = AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": True}}})
    draft = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=draft_type,
        account_id=account_id,
        draft_owner_key=account_id or "",
        config_snapshot=agent_soul,
    )
    session.add_all([agent, draft])
    session.commit()

    result = AgentComposerService.load_agent_soul_for_debug(
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
        draft_type=draft_type,
        session=session,
    )

    assert result == agent_soul


def test_load_agent_soul_for_debug_requires_existing_build_draft(sqlite_session: Session):
    session = sqlite_session

    with pytest.raises(AgentVersionNotFoundError):
        AgentComposerService.load_agent_soul_for_debug(
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="account-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            session=session,
        )


def test_agent_app_build_draft_apply_marks_unpublished_when_build_draft_differs(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Iris",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="version-1",
        active_config_is_published=True,
    )
    active_agent_soul = _agent_soul_with_model()
    build_agent_soul = AgentSoulConfig.model_validate(
        {
            **active_agent_soul.model_dump(mode="json"),
            "prompt": {
                "system_prompt": "Build draft prompt",
            },
        }
    )
    build_draft = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        base_snapshot_id="version-1",
        agent_workspace_binding_id="binding-1",
        config_snapshot=build_agent_soul,
    )
    normal_draft = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        base_snapshot_id="version-1",
        config_snapshot=active_agent_soul,
    )
    active_version = AgentConfigSnapshot(
        id="version-1",
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        version=1,
        home_snapshot_id="home-initial",
        config_snapshot=active_agent_soul,
    )
    session.add_all([agent, build_draft, normal_draft, active_version])
    session.commit()
    create_home = MagicMock(return_value=SimpleNamespace(id="home-build", snapshot_ref="backend-home-build"))
    monkeypatch.setattr(AgentHomeSnapshotService, "create_for_build_apply", create_home)
    monkeypatch.setattr(AgentWorkspaceService, "retire_binding", MagicMock())
    monkeypatch.setattr(composer_service, "enqueue_agent_resource_collection", MagicMock())

    AgentComposerService.apply_agent_app_build_draft(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )

    assert normal_draft.config_snapshot_dict == build_draft.config_snapshot_dict
    assert agent.active_config_is_published is False
    assert session.get(AgentConfigDraft, build_draft.id) is None
    create_home.assert_called_once_with(
        session=session,
        build_draft=build_draft,
    )


def test_agent_app_composer_candidates_and_impact(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    bindings = [
        WorkflowAgentNodeBinding(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id=node_id,
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="agent-1",
            current_snapshot_id="version-1",
            node_job_config=WorkflowNodeJobConfig(),
        )
        for node_id in ("node-1", "node-2")
    ]
    session.add_all(bindings)
    session.commit()

    # Candidates assembly is covered in test_composer_candidates.py; here we stub
    # the IO loaders and assert the response envelope per variant (ENG-615).
    def _no_draft_workflow(**kwargs):
        raise ValueError("draft workflow not found")

    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", _no_draft_workflow)
    monkeypatch.setattr(AgentComposerService, "_load_agent_soul", lambda **kwargs: None)
    monkeypatch.setattr(AgentComposerService, "_workspace_dify_tools", lambda **kwargs: [])

    workflow_candidates = AgentComposerService.get_workflow_candidates(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node-1",
        user_id="account-1",
    )
    agent_app_candidates = AgentComposerService.get_agent_app_candidates(
        session=session, tenant_id="tenant-1", agent_id="agent-1", user_id="account-1"
    )
    impact = AgentComposerService.calculate_impact(
        session=session, tenant_id="tenant-1", current_snapshot_id="version-1"
    )

    assert workflow_candidates["variant"] == "workflow"
    assert workflow_candidates["allowed_node_job_candidates"]["previous_node_outputs"] == []
    assert workflow_candidates["truncated"] is False
    assert agent_app_candidates["variant"] == "agent_app"
    assert agent_app_candidates["allowed_soul_candidates"]["dify_tools"] == []
    assert impact["workflow_node_count"] == 2
    assert impact["bindings"][1]["node_id"] == "node-2"


def test_serialize_workflow_state_changes_lock_and_save_options(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="agent-1",
        current_snapshot_id="version-1",
        workflow_id="workflow-1",
        node_id="node-1",
        node_job_config='{"workflow_prompt":"do work"}',
    )
    agent = Agent(
        id="agent-1",
        name="Analyst",
        description="Clarifies tenders",
        role="Tender Analyst",
        icon_type="emoji",
        icon="robot",
        icon_background="#F5F3FF",
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
        status=AgentStatus.ACTIVE,
    )
    version = AgentConfigSnapshot(id="version-1", version=1, config_snapshot='{"prompt":{"system_prompt":"x"}}')
    monkeypatch.setattr(AgentComposerService, "calculate_impact", lambda **kwargs: {"workflow_node_count": 1})

    state = AgentComposerService._serialize_workflow_state(
        session=session, binding=binding, agent=agent, version=version
    )

    assert state["soul_lock"]["locked"] is True
    assert state["agent"]["role"] == "Tender Analyst"
    assert state["agent"]["icon_type"] == "emoji"
    assert state["agent"]["icon"] == "robot"
    assert state["agent"]["icon_background"] == "#F5F3FF"
    assert "save_as_new_version" in state["save_options"]
    assert state["agent_soul"]["app_features"] == {}
    effective_names = [o["name"] for o in state["effective_declared_outputs"]]
    assert effective_names == ["text"]


def test_serialize_workflow_state_passes_user_declared_outputs_through_effective(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="agent-1",
        current_snapshot_id="version-1",
        workflow_id="workflow-1",
        node_id="node-1",
        node_job_config=(
            '{"workflow_prompt":"work","declared_outputs":[{"name":"summary","type":"string","required":true}]}'
        ),
    )
    agent = Agent(
        id="agent-1",
        name="Analyst",
        description="",
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
        status=AgentStatus.ACTIVE,
    )
    version = AgentConfigSnapshot(id="version-1", version=1, config_snapshot='{"prompt":{"system_prompt":"x"}}')
    monkeypatch.setattr(AgentComposerService, "calculate_impact", lambda **kwargs: {"workflow_node_count": 1})

    state = AgentComposerService._serialize_workflow_state(
        session=session, binding=binding, agent=agent, version=version
    )

    effective = state["effective_declared_outputs"]
    assert [o["name"] for o in effective] == ["text", "summary"]
    assert effective[0]["required"] is False
    assert effective[1]["type"] == "string"
    assert effective[1]["required"] is True


def test_serialize_workflow_state_includes_inline_debug_conversation_message_state(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    session = sqlite_session
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="agent-1",
        current_snapshot_id="version-1",
        workflow_id="workflow-1",
        node_id="node-1",
        node_job_config='{"workflow_prompt":"work"}',
    )
    agent = Agent(
        id="agent-1",
        name="Inline Agent",
        description="",
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
        backing_app_id="backing-app-1",
    )
    version = AgentConfigSnapshot(id="version-1", version=1, config_snapshot='{"prompt":{"system_prompt":"x"}}')
    monkeypatch.setattr(AgentComposerService, "calculate_impact", lambda **kwargs: {"workflow_node_count": 1})
    monkeypatch.setattr(
        AgentComposerService,
        "_workflow_inline_debug_conversation_id",
        lambda **kwargs: "debug-conversation-1",
    )
    monkeypatch.setattr(
        roster_service.AgentRosterService,
        "count_agent_app_debug_conversation_messages",
        lambda self, *, conversation_id: 2,
    )

    state = AgentComposerService._serialize_workflow_state(
        session=session,
        binding=binding,
        agent=agent,
        version=version,
        account_id="account-1",
    )

    assert state["debug_conversation_id"] == "debug-conversation-1"
    assert state["debug_conversation_has_messages"] is True
    assert state["debug_conversation_message_count"] == 2


def test_composer_save_helpers_create_and_rebind_agents(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    workflow_agent = SimpleNamespace(id="inline-agent-1", active_config_snapshot_id="inline-version-1")
    roster_agent = SimpleNamespace(
        id="roster-agent-1",
        active_config_snapshot_id="roster-version-1",
        name="Roster",
        description="Source description",
        role="Source role",
        icon_type="emoji",
        icon="source",
        icon_background="#FFFFFF",
        scope=AgentScope.WORKFLOW_ONLY,
    )
    create_roster_calls = []
    monkeypatch.setattr(AgentComposerService, "_create_workflow_only_agent", lambda **kwargs: workflow_agent)

    def fake_create_roster_agent_for_composer(**kwargs):
        create_roster_calls.append(kwargs)
        return roster_agent

    monkeypatch.setattr(
        AgentComposerService,
        "_create_roster_agent_for_composer",
        fake_create_roster_agent_for_composer,
    )
    monkeypatch.setattr(AgentComposerService, "_require_agent", lambda **kwargs: roster_agent)
    monkeypatch.setattr(
        AgentComposerService,
        "_require_version",
        lambda **kwargs: AgentConfigSnapshot(
            id="source-version-1",
            tenant_id="tenant-1",
            agent_id="roster-agent-1",
            version=1,
            home_snapshot_id="home-source",
            config_snapshot='{"prompt":{"system_prompt":"old"}}',
        ),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_create_config_version",
        lambda **kwargs: AgentConfigSnapshot(id="new-version-1", version=2),
    )
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW.value,
            "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY.value,
            "agent_soul": {"prompt": {"system_prompt": "new"}},
            "node_job": {"workflow_prompt": "use prior output"},
            "new_agent_name": "Copied Agent",
            "description": "Copied description",
            "role": "Copied role",
            "icon_type": "emoji",
            "icon": "copied",
            "icon_background": "#E0F2FE",
        }
    )
    existing_binding = WorkflowAgentNodeBinding(agent_id="inline-agent-1", current_snapshot_id="inline-version-1")

    updated_binding = AgentComposerService._save_node_job_only(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-1",
        account_id="account-1",
        binding=existing_binding,
        payload=payload,
    )
    inline_binding = AgentComposerService._save_node_job_only(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-2",
        account_id="account-1",
        binding=None,
        payload=payload,
    )
    new_agent_binding = AgentComposerService._save_as_new_agent(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-3",
        account_id="account-1",
        binding=None,
        payload=payload,
    )
    save_to_roster_binding = AgentComposerService._save_to_roster(
        session=session,
        tenant_id="tenant-1",
        account_id="account-1",
        binding=WorkflowAgentNodeBinding(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            node_id="node-4",
            agent_id="inline-agent-1",
            current_snapshot_id="inline-version-1",
        ),
        payload=payload,
    )
    new_version_binding = AgentComposerService._save_as_new_version(
        session=session,
        tenant_id="tenant-1",
        account_id="account-1",
        binding=WorkflowAgentNodeBinding(agent_id="roster-agent-1", current_snapshot_id="source-version-1"),
        payload=payload,
    )

    assert updated_binding.updated_by == "account-1"
    assert inline_binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT
    assert inline_binding.agent_id == "inline-agent-1"
    assert new_agent_binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
    assert save_to_roster_binding.agent_id == "roster-agent-1"
    assert new_version_binding.current_snapshot_id == "new-version-1"
    assert create_roster_calls[0]["description"] == "Copied description"
    assert create_roster_calls[0]["role"] == "Copied role"
    assert create_roster_calls[0]["icon"] == "copied"
    assert create_roster_calls[0]["icon_background"] == "#E0F2FE"
    assert create_roster_calls[1]["description"] == "Copied description"
    assert create_roster_calls[1]["role"] == "Copied role"
    assert create_roster_calls[1]["icon"] == "copied"
    assert create_roster_calls[1]["icon_background"] == "#E0F2FE"


def test_node_job_only_updates_inline_agent_soul(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    inline_agent = SimpleNamespace(
        id="inline-agent-1",
        scope=AgentScope.WORKFLOW_ONLY,
        active_config_snapshot_id="inline-version-1",
        active_config_has_model=False,
        updated_by=None,
    )
    current_snapshot = AgentConfigSnapshot(
        id="inline-version-1",
        tenant_id="tenant-1",
        agent_id="inline-agent-1",
        version=1,
        home_snapshot_id="home-inline-1",
        config_snapshot='{"prompt":{"system_prompt":"old"}}',
    )
    next_snapshot = AgentConfigSnapshot(
        id="inline-version-2",
        tenant_id="tenant-1",
        agent_id="inline-agent-1",
        version=2,
        home_snapshot_id="home-inline-2",
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "model": {
                    "plugin_id": "langgenius/openai/openai",
                    "model_provider": "openai",
                    "model": "gpt-4o",
                },
                "prompt": {"system_prompt": "new"},
            }
        ),
    )
    normal_draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id="inline-agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        base_snapshot_id="inline-version-1",
        home_snapshot_id="home-inline-1",
        config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "old"}}),
    )

    monkeypatch.setattr(AgentComposerService, "_require_version", lambda **kwargs: current_snapshot)
    monkeypatch.setattr(AgentComposerService, "_update_current_version", lambda **kwargs: next_snapshot)
    monkeypatch.setattr(AgentComposerService, "_require_agent", lambda **kwargs: inline_agent)
    monkeypatch.setattr(AgentComposerService, "_get_agent_draft", lambda **kwargs: normal_draft)

    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="inline-agent-1",
        current_snapshot_id="inline-version-1",
    )
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW.value,
            "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY.value,
            "agent_soul": {
                "model": {
                    "plugin_id": "langgenius/openai/openai",
                    "model_provider": "openai",
                    "model": "gpt-4o",
                },
                "prompt": {"system_prompt": "new"},
            },
            "node_job": {"workflow_prompt": "use prior output"},
        }
    )

    updated_binding = AgentComposerService._save_node_job_only(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-1",
        account_id="account-1",
        binding=binding,
        payload=payload,
    )

    assert updated_binding.current_snapshot_id == "inline-version-2"
    assert updated_binding.node_job_config_dict["workflow_prompt"] == "use prior output"
    assert updated_binding.updated_by == "account-1"
    assert inline_agent.active_config_snapshot_id == "inline-version-2"
    assert inline_agent.active_config_has_model is True
    assert inline_agent.updated_by == "account-1"
    assert normal_draft.id == "draft-1"
    assert normal_draft.base_snapshot_id == "inline-version-2"
    assert normal_draft.home_snapshot_id == "home-inline-2"
    assert normal_draft.config_snapshot_dict == next_snapshot.config_snapshot_dict
    assert normal_draft.updated_by == "account-1"


def test_get_or_create_normal_agent_draft_rebases_stale_workflow_only_draft(sqlite_session: Session):
    session = sqlite_session
    agent = Agent(
        id="inline-agent-1",
        tenant_id="tenant-1",
        name="Inline",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="inline-version-2",
        created_by="account-1",
        updated_by="account-2",
    )
    draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        base_snapshot_id="inline-version-1",
        home_snapshot_id="home-inline-1",
        config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "old"}}),
    )
    active_snapshot = AgentConfigSnapshot(
        id="inline-version-2",
        tenant_id="tenant-1",
        agent_id=agent.id,
        version=2,
        home_snapshot_id="home-inline-2",
        config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "new"}}),
    )
    session.add_all([agent, draft, active_snapshot])
    session.commit()

    resolved = AgentComposerService.get_or_create_normal_agent_draft(
        session=session,
        tenant_id="tenant-1",
        agent=agent,
        created_by="account-2",
    )

    assert resolved is draft
    assert resolved.id == "draft-1"
    assert resolved.base_snapshot_id == "inline-version-2"
    assert resolved.home_snapshot_id == "home-inline-2"
    assert resolved.config_snapshot_dict == active_snapshot.config_snapshot_dict
    assert resolved.updated_by == "account-2"


def test_get_or_create_normal_agent_draft_keeps_roster_draft_edits(sqlite_session: Session):
    session = sqlite_session
    agent = Agent(
        id="roster-agent-1",
        tenant_id="tenant-1",
        name="Roster",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="version-2",
    )
    draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        base_snapshot_id="version-1",
        config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "local edit"}}),
    )
    session.add_all([agent, draft])
    session.commit()

    resolved = AgentComposerService.get_or_create_normal_agent_draft(
        session=session,
        tenant_id="tenant-1",
        agent=agent,
        created_by="account-1",
    )

    assert resolved is draft
    assert resolved.base_snapshot_id == "version-1"
    assert resolved.config_snapshot_dict["prompt"]["system_prompt"] == "local edit"


def test_node_job_only_switches_roster_binding_to_inline_agent(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    created_agent = SimpleNamespace(id="inline-agent-1", active_config_snapshot_id="inline-version-1")
    captured: dict[str, object] = {}

    def fake_create_workflow_only_agent(**kwargs):
        captured.update(kwargs)
        return created_agent

    monkeypatch.setattr(AgentComposerService, "_create_workflow_only_agent", fake_create_workflow_only_agent)
    existing_node_job = WorkflowNodeJobConfig(workflow_prompt="keep the existing task")
    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="roster-agent-1",
        current_snapshot_id="roster-version-1",
        node_job_config=existing_node_job,
        created_by="account-1",
        updated_by="account-1",
    )
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW.value,
            "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY.value,
            "binding": {"binding_type": WorkflowAgentBindingType.INLINE_AGENT.value},
            "agent_soul": {"prompt": {"system_prompt": "start from scratch"}},
        }
    )

    updated_binding = AgentComposerService._save_node_job_only(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-1",
        account_id="account-1",
        binding=binding,
        payload=payload,
    )

    assert updated_binding is binding
    assert binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT
    assert binding.agent_id == "inline-agent-1"
    assert binding.current_snapshot_id == "inline-version-1"
    assert binding.node_job_config is existing_node_job
    assert binding.updated_by == "account-1"
    assert captured["tenant_id"] == "tenant-1"
    assert captured["app_id"] == "app-1"
    assert captured["workflow_id"] == "workflow-1"
    assert captured["node_id"] == "node-1"
    assert captured["account_id"] == "account-1"
    assert captured["agent_soul"].prompt.system_prompt == "start from scratch"


def test_node_job_only_rejects_start_from_scratch_with_existing_inline_binding_id(sqlite_session: Session):
    session = sqlite_session
    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="roster-agent-1",
        current_snapshot_id="roster-version-1",
        node_job_config=WorkflowNodeJobConfig(),
    )
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW.value,
            "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY.value,
            "binding": {
                "binding_type": WorkflowAgentBindingType.INLINE_AGENT.value,
                "agent_id": "existing-inline-agent",
            },
        }
    )

    with pytest.raises(ValueError, match="Start from Scratch"):
        AgentComposerService._save_node_job_only(
            session=session,
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            node_id="node-1",
            account_id="account-1",
            binding=binding,
            payload=payload,
        )


def test_node_job_only_rejects_inline_binding_pointing_to_roster_agent(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    current_snapshot = AgentConfigSnapshot(
        id="inline-version-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot='{"prompt":{"system_prompt":"old"}}',
    )
    next_snapshot = AgentConfigSnapshot(id="inline-version-2", tenant_id="tenant-1", agent_id="agent-1", version=2)
    roster_agent = SimpleNamespace(id="agent-1", scope=AgentScope.ROSTER)

    monkeypatch.setattr(AgentComposerService, "_require_version", lambda **kwargs: current_snapshot)
    monkeypatch.setattr(AgentComposerService, "_update_current_version", lambda **kwargs: next_snapshot)
    monkeypatch.setattr(AgentComposerService, "_require_agent", lambda **kwargs: roster_agent)

    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="agent-1",
        current_snapshot_id="inline-version-1",
    )
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW.value,
            "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY.value,
            "agent_soul": {"prompt": {"system_prompt": "new"}},
        }
    )

    with pytest.raises(ValueError, match="workflow-only agent"):
        AgentComposerService._save_node_job_only(
            session=session,
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            node_id="node-1",
            account_id="account-1",
            binding=binding,
            payload=payload,
        )


def test_copy_workflow_composer_from_roster_creates_inline_agent_and_preserves_node_job(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    session = sqlite_session
    workflow = SimpleNamespace(id="workflow-1")
    node_job = WorkflowNodeJobConfig(workflow_prompt="keep this node task")
    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="roster-agent-1",
        current_snapshot_id="old-roster-version",
        node_job_config=node_job,
    )
    roster_agent = Agent(
        id="roster-agent-1",
        tenant_id="tenant-1",
        name="Nadia",
        description="Clarification Drafter",
        role="Clarifies tenders",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="roster-version-2",
    )
    source_version = AgentConfigSnapshot(
        id="roster-version-2",
        tenant_id="tenant-1",
        agent_id="roster-agent-1",
        version=2,
        config_snapshot='{"prompt":{"system_prompt":"copy me"}}',
    )
    session.add(
        AgentConfigRevision(
            tenant_id="tenant-1",
            agent_id=roster_agent.id,
            current_snapshot_id=source_version.id,
            revision=1,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        )
    )
    session.commit()
    inline_agent = Agent(
        id="inline-agent-1",
        tenant_id="tenant-1",
        name="Nadia",
        description="Clarification Drafter",
        role="Clarifies tenders",
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="inline-version-1",
    )
    captured: dict[str, object] = {}

    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: workflow)
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: binding)
    monkeypatch.setattr(AgentComposerService, "_require_agent", lambda **kwargs: roster_agent)
    monkeypatch.setattr(AgentComposerService, "_require_version", lambda **kwargs: source_version)

    def fake_create_workflow_only_agent(**kwargs):
        captured["create"] = kwargs
        return inline_agent

    monkeypatch.setattr(AgentComposerService, "_create_workflow_only_agent", fake_create_workflow_only_agent)
    monkeypatch.setattr(
        AgentComposerService,
        "_serialize_workflow_state",
        lambda **kwargs: {
            "binding": {
                "binding_type": kwargs["binding"].binding_type.value,
                "agent_id": kwargs["binding"].agent_id,
                "current_snapshot_id": kwargs["binding"].current_snapshot_id,
            },
            "node_job": kwargs["binding"].node_job_config_dict,
        },
    )

    state = AgentComposerService.copy_workflow_composer_from_roster(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node-1",
        account_id="account-1",
        source_agent_id="roster-agent-1",
        source_snapshot_id="roster-version-2",
    )

    assert state["binding"]["binding_type"] == WorkflowAgentBindingType.INLINE_AGENT.value
    assert state["binding"]["agent_id"] == "inline-agent-1"
    assert state["node_job"]["workflow_prompt"] == "keep this node task"
    assert binding.node_job_config is node_job
    create_kwargs = captured["create"]
    assert create_kwargs["agent_soul"].prompt.system_prompt == "copy me"
    assert create_kwargs["name"] == "Nadia"
    assert create_kwargs["role"] == "Clarifies tenders"


def test_copy_workflow_composer_from_roster_rejects_stale_source_snapshot(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(
        AgentComposerService,
        "_get_workflow_binding",
        lambda **kwargs: WorkflowAgentNodeBinding(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version="draft",
            node_id="node-1",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="roster-agent-1",
            current_snapshot_id="roster-version-1",
            node_job_config=WorkflowNodeJobConfig(),
        ),
    )
    roster_agent = Agent(
        id="roster-agent-1",
        tenant_id="tenant-1",
        name="Nadia",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="roster-version-2",
    )
    source_version = AgentConfigSnapshot(
        id="roster-version-2",
        tenant_id="tenant-1",
        agent_id="roster-agent-1",
        version=2,
        config_snapshot='{"prompt":{"system_prompt":"copy me"}}',
    )
    session.add(
        AgentConfigRevision(
            tenant_id="tenant-1",
            agent_id=roster_agent.id,
            current_snapshot_id=source_version.id,
            revision=1,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        )
    )
    session.commit()
    monkeypatch.setattr(AgentComposerService, "_require_agent", lambda **kwargs: roster_agent)
    monkeypatch.setattr(AgentComposerService, "_require_version", lambda **kwargs: source_version)

    with pytest.raises(AgentVersionConflictError):
        AgentComposerService.copy_workflow_composer_from_roster(
            session=session,
            tenant_id="tenant-1",
            app_id="app-1",
            node_id="node-1",
            account_id="account-1",
            source_agent_id="roster-agent-1",
            source_snapshot_id="roster-version-1",
        )


def test_copy_workflow_composer_from_roster_rejects_unpublished_source(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="roster-agent-1",
        current_snapshot_id="roster-version-1",
        node_job_config=WorkflowNodeJobConfig(),
    )
    source_agent = Agent(
        id="roster-agent-1",
        tenant_id="tenant-1",
        name="Unpublished import",
        scope=AgentScope.ROSTER,
        source=AgentSource.IMPORTED,
        app_id="agent-app-1",
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="roster-version-1",
    )
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: binding)
    monkeypatch.setattr(AgentComposerService, "_require_agent", lambda **kwargs: source_agent)
    require_version = MagicMock(side_effect=AssertionError("unpublished source must fail before loading snapshot"))
    monkeypatch.setattr(AgentComposerService, "_require_version", require_version)

    with pytest.raises(InvalidComposerConfigError, match="published config snapshot"):
        AgentComposerService.copy_workflow_composer_from_roster(
            session=session,
            tenant_id="tenant-1",
            app_id="app-1",
            node_id="node-1",
            account_id="account-1",
            source_agent_id="roster-agent-1",
        )

    require_version.assert_not_called()
    assert not session.new
    assert not session.dirty


def test_copy_workflow_composer_from_roster_is_idempotent_when_already_inline(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    inline_binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="inline-agent-1",
        current_snapshot_id="inline-version-1",
    )
    inline_agent = Agent(
        id="inline-agent-1",
        tenant_id="tenant-1",
        name="Inline",
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="inline-version-1",
    )
    inline_version = AgentConfigSnapshot(
        id="inline-version-1",
        tenant_id="tenant-1",
        agent_id="inline-agent-1",
        version=1,
        config_snapshot='{"prompt":{"system_prompt":"inline"}}',
    )
    serialize_calls = []
    session = sqlite_session
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: inline_binding)
    monkeypatch.setattr(AgentComposerService, "_get_agent_if_present", lambda **kwargs: inline_agent)
    monkeypatch.setattr(AgentComposerService, "_get_version_if_present", lambda **kwargs: inline_version)

    def serialize_workflow_state(**kwargs):
        serialize_calls.append(kwargs)
        return {"binding_type": kwargs["binding"].binding_type.value}

    monkeypatch.setattr(AgentComposerService, "_serialize_workflow_state", serialize_workflow_state)

    state = AgentComposerService.copy_workflow_composer_from_roster(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node-1",
        account_id="account-1",
        source_agent_id="roster-agent-1",
        idempotency_key="same-click",
    )

    assert state == {"binding_type": WorkflowAgentBindingType.INLINE_AGENT.value}
    assert serialize_calls[0]["account_id"] == "account-1"


@pytest.mark.parametrize(
    ("binding_agent_id", "binding_type", "source_scope", "source_status", "expected_message"),
    [
        (
            "roster-agent-1",
            WorkflowAgentBindingType.INLINE_AGENT,
            AgentScope.ROSTER,
            AgentStatus.ACTIVE,
            "must be bound to a roster agent",
        ),
        (
            "other-agent",
            WorkflowAgentBindingType.ROSTER_AGENT,
            AgentScope.ROSTER,
            AgentStatus.ACTIVE,
            "does not match",
        ),
        (
            "roster-agent-1",
            WorkflowAgentBindingType.ROSTER_AGENT,
            AgentScope.WORKFLOW_ONLY,
            AgentStatus.ACTIVE,
            "must be an active roster agent",
        ),
        (
            "roster-agent-1",
            WorkflowAgentBindingType.ROSTER_AGENT,
            AgentScope.ROSTER,
            AgentStatus.ARCHIVED,
            "must be an active roster agent",
        ),
    ],
)
def test_copy_workflow_composer_from_roster_rejects_invalid_source_binding(
    monkeypatch: pytest.MonkeyPatch,
    binding_agent_id: str,
    binding_type: WorkflowAgentBindingType,
    source_scope: AgentScope,
    source_status: AgentStatus,
    expected_message: str,
    sqlite_session: Session,
):
    session = sqlite_session
    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="node-1",
        binding_type=binding_type,
        agent_id=binding_agent_id,
        current_snapshot_id="version-1",
        node_job_config=WorkflowNodeJobConfig(),
    )
    source_agent = Agent(
        id="roster-agent-1",
        tenant_id="tenant-1",
        name="Source",
        scope=source_scope,
        source=AgentSource.AGENT_APP,
        status=source_status,
        active_config_snapshot_id="version-1",
    )
    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", lambda **kwargs: SimpleNamespace(id="workflow-1"))
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", lambda **kwargs: binding)
    monkeypatch.setattr(AgentComposerService, "_require_agent", lambda **kwargs: source_agent)

    with pytest.raises(InvalidComposerConfigError, match=expected_message):
        AgentComposerService.copy_workflow_composer_from_roster(
            session=session,
            tenant_id="tenant-1",
            app_id="app-1",
            node_id="node-1",
            account_id="account-1",
            source_agent_id="roster-agent-1",
        )


def test_composer_create_agents_syncs_active_config_has_model(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    session = sqlite_session
    created_apps = []
    hidden_backing_apps = []
    backing_agent = Agent(
        id="roster-agent-1",
        tenant_id="tenant-1",
        name="Ready Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        app_id="app-agent-1",
        active_config_snapshot_id="empty-version-1",
    )

    class FakeAppService:
        def create_app(self, tenant_id, params, account, *, session):
            created_apps.append((tenant_id, params, account))
            return SimpleNamespace(id="app-agent-1")

    class FakeAgentRosterService:
        def __init__(self, session):
            self.session = session

        def create_hidden_backing_app_for_workflow_agent(self, **kwargs):
            hidden_backing_apps.append(kwargs)
            return SimpleNamespace(id="hidden-app-1")

        def get_app_backing_agent(self, *, tenant_id, app_id):
            assert tenant_id == "tenant-1"
            assert app_id == "app-agent-1"
            return backing_agent

    monkeypatch.setattr(composer_service, "AppService", FakeAppService)
    monkeypatch.setattr(composer_service, "AgentRosterService", FakeAgentRosterService)
    monkeypatch.setattr(AgentComposerService, "_require_account", lambda **kwargs: SimpleNamespace(id="account-1"))
    monkeypatch.setattr(
        AgentComposerService,
        "_require_version",
        lambda **kwargs: SimpleNamespace(
            id="empty-version-1",
            tenant_id="tenant-1",
            agent_id="roster-agent-1",
            home_snapshot_id=None,
        ),
    )
    create_config_version = MagicMock(return_value=SimpleNamespace(id="version-with-model"))
    monkeypatch.setattr(AgentComposerService, "_create_config_version", create_config_version)

    workflow_agent = AgentComposerService._create_workflow_only_agent(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="node-1",
        account_id="account-1",
        agent_soul=_agent_soul_with_model(),
    )
    roster_agent = AgentComposerService._create_roster_agent_for_composer(
        session=session,
        tenant_id="tenant-1",
        account_id="account-1",
        name="Ready Agent",
        agent_soul=_agent_soul_with_model(),
        operation=AgentConfigRevisionOperation.CREATE_VERSION,
        version_note=None,
    )

    assert workflow_agent.active_config_snapshot_id == "version-with-model"
    assert workflow_agent.active_config_has_model is True
    assert workflow_agent.backing_app_id == "hidden-app-1"
    assert create_config_version.call_count == 2
    assert all(call.kwargs["home_snapshot_id"] is None for call in create_config_version.call_args_list)
    assert hidden_backing_apps[0]["name"] == "Workflow Agent node-1"
    assert roster_agent.active_config_snapshot_id == "version-with-model"
    assert roster_agent.active_config_has_model is True
    assert roster_agent.source == AgentSource.AGENT_APP
    assert roster_agent.app_id == "app-agent-1"
    created_tenant_id, created_params, created_account = created_apps[0]
    assert created_tenant_id == "tenant-1"
    assert created_params.mode == "agent"
    assert created_params.name == "Ready Agent"
    assert created_account.id == "account-1"


def test_composer_require_account(sqlite_session: Session):
    session = sqlite_session
    account = Account(name="Tester", email="tester@example.com")
    account.id = "account-1"
    session.add(account)
    session.commit()

    assert AgentComposerService._require_account(session=session, account_id="account-1") is account


def test_composer_require_account_raises_when_missing(sqlite_session: Session):
    with pytest.raises(ValueError, match="Account not found"):
        AgentComposerService._require_account(session=sqlite_session, account_id="missing-account")


def test_composer_create_roster_agent_maps_name_conflict_without_owning_rollback(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    transaction = session.begin()

    class FakeAppService:
        def create_app(self, tenant_id, params, account, *, session):
            raise IntegrityError("insert apps", params, Exception("duplicate"))

    monkeypatch.setattr(composer_service, "AppService", FakeAppService)
    monkeypatch.setattr(AgentComposerService, "_require_account", lambda **kwargs: SimpleNamespace(id="account-1"))

    with pytest.raises(AgentNameConflictError):
        AgentComposerService._create_roster_agent_for_composer(
            session=session,
            tenant_id="tenant-1",
            account_id="account-1",
            name="Duplicate Agent",
            agent_soul=_agent_soul_with_model(),
            operation=AgentConfigRevisionOperation.CREATE_VERSION,
            version_note=None,
        )

    assert transaction.is_active


def test_composer_create_roster_agent_raises_when_backing_agent_missing(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session

    class FakeAppService:
        def create_app(self, tenant_id, params, account, *, session):
            return SimpleNamespace(id="app-agent-1")

    class FakeAgentRosterService:
        def __init__(self, session):
            self.session = session

        def get_app_backing_agent(self, *, tenant_id, app_id):
            return None

    monkeypatch.setattr(composer_service, "AppService", FakeAppService)
    monkeypatch.setattr(composer_service, "AgentRosterService", FakeAgentRosterService)
    monkeypatch.setattr(AgentComposerService, "_require_account", lambda **kwargs: SimpleNamespace(id="account-1"))

    with pytest.raises(AgentNotFoundError):
        AgentComposerService._create_roster_agent_for_composer(
            session=session,
            tenant_id="tenant-1",
            account_id="account-1",
            name="Missing Backing Agent",
            agent_soul=_agent_soul_with_model(),
            operation=AgentConfigRevisionOperation.CREATE_VERSION,
            version_note=None,
        )


def test_agent_app_draft_match_does_not_mark_create_version_as_published(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    agent_soul = AgentSoulConfig()
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        source=AgentSource.AGENT_APP,
        active_config_snapshot_id="snapshot-1",
    )
    snapshot = SimpleNamespace(config_snapshot_dict=agent_soul, home_snapshot_id="home-1")
    session = sqlite_session
    monkeypatch.setattr(AgentComposerService, "_get_version_if_present", lambda **kwargs: snapshot)

    assert (
        AgentComposerService._agent_soul_matches_active_config(
            session=session,
            tenant_id="tenant-1",
            agent=agent,
            agent_soul=agent_soul,
            home_snapshot_id="home-1",
        )
        is False
    )


def test_agent_app_draft_match_marks_publish_visible_revision_as_published(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    agent_soul = AgentSoulConfig()
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        source=AgentSource.AGENT_APP,
        active_config_snapshot_id="snapshot-1",
    )
    snapshot = SimpleNamespace(config_snapshot_dict=agent_soul, home_snapshot_id="home-1")
    session = sqlite_session
    session.add(
        AgentConfigRevision(
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            current_snapshot_id=agent.active_config_snapshot_id,
            revision=1,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        )
    )
    session.commit()
    monkeypatch.setattr(AgentComposerService, "_get_version_if_present", lambda **kwargs: snapshot)

    assert (
        AgentComposerService._agent_soul_matches_active_config(
            session=session,
            tenant_id="tenant-1",
            agent=agent,
            agent_soul=agent_soul,
            home_snapshot_id="home-1",
        )
        is True
    )


def test_composer_version_helpers_and_lookup_errors(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    agent = _agent()
    initial_snapshot = _snapshot(snapshot_id="version-1")
    initial_revision = AgentConfigRevision(
        tenant_id="tenant-1",
        agent_id=agent.id,
        current_snapshot_id=initial_snapshot.id,
        revision=1,
        operation=AgentConfigRevisionOperation.CREATE_VERSION,
    )
    workflow_row = _workflow()
    session.add_all([agent, initial_snapshot, initial_revision, workflow_row])
    session.commit()
    agent_soul = AgentSoulConfig.model_validate({"prompt": {"system_prompt": "new"}})
    version = AgentComposerService._create_config_version(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
        agent_soul=agent_soul,
        operation=AgentConfigRevisionOperation.SAVE_NEW_VERSION,
        version_note="note",
        home_snapshot_id="home-1",
    )
    updated_snapshot = AgentComposerService._update_current_version(
        session=session,
        current_snapshot=AgentConfigSnapshot(
            id="version-1",
            tenant_id="tenant-1",
            agent_id="agent-1",
            version=1,
            home_snapshot_id="home-1",
            config_snapshot='{"prompt":{"system_prompt":"old"}}',
        ),
        account_id="account-1",
        agent_soul=agent_soul,
        operation=AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
        version_note="updated",
    )
    workflow = AgentComposerService._get_draft_workflow(session=session, tenant_id="tenant-1", app_id="app-1")

    with pytest.raises(ValueError):
        AgentComposerService._get_draft_workflow(session=session, tenant_id="tenant-1", app_id="missing")
    assert (
        AgentComposerService._require_agent(session=session, tenant_id="tenant-1", agent_id="agent-1").id == "agent-1"
    )
    with pytest.raises(composer_service.AgentNotFoundError):
        AgentComposerService._require_agent(session=session, tenant_id="tenant-1", agent_id=None)
    assert AgentComposerService._get_agent_if_present(session=session, tenant_id="tenant-1", agent_id="missing") is None
    assert (
        AgentComposerService._require_version(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            version_id="version-1",
        ).id
        == "version-1"
    )
    with pytest.raises(composer_service.AgentVersionNotFoundError):
        AgentComposerService._require_version(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            version_id="missing",
        )

    assert version.version == 2
    assert updated_snapshot.version == 3
    assert version.home_snapshot_id == "home-1"
    assert updated_snapshot.home_snapshot_id == "home-1"
    assert workflow.id == "workflow-1"


def test_composer_current_version_and_error_paths(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.WORKFLOW.value,
            "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
            "agent_soul": {"prompt": {"system_prompt": "updated"}},
            "node_job": {"workflow_prompt": "job"},
        }
    )
    binding = WorkflowAgentNodeBinding(agent_id="agent-1", current_snapshot_id="version-1")
    version = AgentConfigSnapshot(
        id="version-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        home_snapshot_id="home-1",
        config_snapshot='{"prompt":{"system_prompt":"old"}}',
    )
    monkeypatch.setattr(AgentComposerService, "_require_version", lambda **kwargs: version)
    monkeypatch.setattr(
        AgentComposerService,
        "_require_agent",
        lambda **kwargs: SimpleNamespace(updated_by=None, active_config_is_published=False),
    )
    result = AgentComposerService._save_to_current_version(
        session=session,
        tenant_id="tenant-1",
        account_id="account-1",
        binding=binding,
        payload=payload,
    )

    assert result.updated_by == "account-1"
    assert result.current_snapshot_id != "version-1"
    created_version = session.get(AgentConfigSnapshot, result.current_snapshot_id)
    assert created_version is not None
    assert created_version.home_snapshot_id == "home-1"
    with pytest.raises(ValueError):
        AgentComposerService._require_binding(None)
    with pytest.raises(ValueError):
        AgentComposerService._save_as_new_agent(
            session=session,
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            node_id="node-1",
            account_id="account-1",
            binding=None,
            payload=ComposerSavePayload.model_validate(
                {
                    "variant": ComposerVariant.WORKFLOW.value,
                    "save_strategy": ComposerSaveStrategy.SAVE_AS_NEW_AGENT.value,
                }
            ),
        )


def test_roster_list_and_invite_options(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    updated_at = datetime(2026, 1, 3, 3, 4, 5, tzinfo=UTC)
    version_created_at = datetime(2026, 1, 4, 3, 4, 5, tzinfo=UTC)
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Analyst",
        description="",
        role="researcher",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    agent.created_at = created_at
    agent.updated_at = updated_at
    version = AgentConfigSnapshot(
        id="version-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=_agent_soul_with_model(),
    )
    version.created_at = version_created_at
    agent.active_config_snapshot_id = "version-1"
    agent.active_config_has_model = True
    agent.active_config_is_published = True
    unconfigured_agent = Agent(
        id="agent-2",
        tenant_id="tenant-1",
        name="Draft Agent",
        description="",
        role="draft",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    unconfigured_agent.active_config_snapshot_id = "version-2"
    unconfigured_agent.active_config_has_model = False
    unconfigured_agent.updated_at = datetime(2026, 1, 1, 3, 4, 5, tzinfo=UTC)
    unconfigured_version = AgentConfigSnapshot(
        id="version-2",
        tenant_id="tenant-1",
        agent_id="agent-2",
        version=1,
        config_snapshot=AgentSoulConfig(),
    )
    workflow_row = _workflow()
    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id=workflow_row.id,
        workflow_version=Workflow.VERSION_DRAFT,
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id=agent.id,
        current_snapshot_id=version.id,
        node_job_config=WorkflowNodeJobConfig(),
    )
    publish_revision = AgentConfigRevision(
        tenant_id="tenant-1",
        agent_id=agent.id,
        current_snapshot_id=version.id,
        revision=1,
        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
    )
    session.add_all([agent, unconfigured_agent, version, unconfigured_version, workflow_row, binding, publish_revision])
    session.commit()
    service = AgentRosterService(session)
    monkeypatch.setattr(service, "_load_published_references_by_agent_id", lambda **kwargs: {})
    monkeypatch.setattr(service, "_load_reference_counts_by_agent_id", lambda **kwargs: {"agent-1": 1})

    listed = service.list_roster_agents(tenant_id="tenant-1", page=1, limit=20)
    invited = service.list_invite_options(tenant_id="tenant-1", page=1, limit=20, app_id="app-1")

    assert [item["id"] for item in listed["data"]] == ["agent-1", "agent-2"]
    assert [item["id"] for item in invited["data"]] == ["agent-1"]
    assert invited["total"] == 1
    assert listed["data"][0]["active_config_snapshot"]["id"] == "version-1"
    assert listed["data"][0]["role"] == "researcher"
    assert listed["data"][0]["created_at"] == int(created_at.timestamp())
    assert listed["data"][0]["updated_at"] == int(updated_at.timestamp())
    assert listed["data"][0]["active_config_snapshot"]["created_at"] == int(version_created_at.timestamp())
    assert listed["data"][0]["active_config_is_published"] is True
    assert listed["data"][0]["reference_count"] == 1
    assert listed["data"][1]["active_config_is_published"] is False
    assert invited["data"][0]["is_in_current_workflow"] is True
    assert invited["data"][0]["existing_node_ids"] == ["node-1"]


def test_invite_options_uses_db_filtered_pagination(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    configured_agent = Agent(
        id="agent-2",
        tenant_id="tenant-1",
        name="Ready Agent",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="version-2",
        active_config_has_model=True,
        active_config_is_published=True,
    )
    version = AgentConfigSnapshot(
        id="version-2",
        tenant_id="tenant-1",
        agent_id="agent-2",
        version=1,
        config_snapshot=_agent_soul_with_model(),
    )
    publish_revision = AgentConfigRevision(
        tenant_id="tenant-1",
        agent_id=configured_agent.id,
        current_snapshot_id=version.id,
        revision=1,
        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
    )
    session.add_all([configured_agent, version, publish_revision])
    session.commit()
    service = AgentRosterService(session)
    monkeypatch.setattr(service, "_load_published_references_by_agent_id", lambda **kwargs: {})
    monkeypatch.setattr(service, "_load_reference_counts_by_agent_id", lambda **kwargs: {})

    result = service.list_invite_options(tenant_id="tenant-1", page=1, limit=1)

    assert result["total"] == 1
    assert result["has_more"] is False
    assert [item["id"] for item in result["data"]] == ["agent-2"]


def test_active_config_is_published_flags_use_stored_agent_state(sqlite_session: Session):
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Published",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="version-1",
        active_config_is_published=True,
    )
    draft_agent = Agent(
        id="agent-2",
        tenant_id="tenant-1",
        name="Draft",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id=None,
        active_config_is_published=True,
    )
    dirty_agent = Agent(
        id="agent-3",
        tenant_id="tenant-1",
        name="Dirty",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="version-3",
        active_config_is_published=False,
    )
    service = AgentRosterService(sqlite_session)

    flags = service.load_active_config_is_published_by_agent_id(
        tenant_id="tenant-1", agents=[agent, draft_agent, dirty_agent]
    )

    assert flags == {"agent-1": True, "agent-2": False, "agent-3": False}
    assert service.active_config_is_published(tenant_id="tenant-1", agent=agent) is True
    assert AgentRosterService(sqlite_session).load_active_config_is_published_by_agent_id(
        tenant_id="tenant-1",
        agents=[draft_agent],
    ) == {"agent-2": False}


def test_active_config_is_published_skips_empty_agent_ids(sqlite_session: Session):
    empty_id_agent = Agent(
        id="",
        tenant_id="tenant-1",
        name="Broken",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id=None,
    )
    session = sqlite_session

    assert (
        AgentRosterService(session).load_active_config_is_published_by_agent_id(
            tenant_id="tenant-1",
            agents=[empty_id_agent],
        )
        == {}
    )


def test_load_app_backing_agents_skips_empty_agent_ids(sqlite_session: Session):
    session = sqlite_session
    valid_agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Valid",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        app_id="app-1",
        status=AgentStatus.ACTIVE,
    )
    empty_id_agent = Agent(
        id="",
        tenant_id="tenant-1",
        name="Broken",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        app_id="app-2",
        status=AgentStatus.ACTIVE,
    )

    session.add_all([valid_agent, empty_id_agent])
    session.commit()
    result = AgentRosterService(session).load_app_backing_agents_by_app_id(
        tenant_id="tenant-1",
        app_ids=["app-1", "app-2"],
    )

    assert result == {"app-1": valid_agent}


def test_published_references_include_app_display_fields_and_sort_by_updated_at(sqlite_session: Session):
    session = sqlite_session
    recent_updated_at = datetime(2026, 1, 7, 3, 4, 5, tzinfo=UTC)
    stale_updated_at = datetime(2026, 1, 6, 3, 4, 5, tzinfo=UTC)
    bindings = [
        WorkflowAgentNodeBinding(
            tenant_id="tenant-1",
            agent_id="agent-1",
            app_id="app-stale",
            workflow_id="workflow-stale",
            workflow_version="published-stale",
            node_id="node-b",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            current_snapshot_id="version-1",
            node_job_config=WorkflowNodeJobConfig(),
        ),
        WorkflowAgentNodeBinding(
            tenant_id="tenant-1",
            agent_id="agent-1",
            app_id="app-recent",
            workflow_id="workflow-recent",
            workflow_version="published-recent",
            node_id="node-a",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            current_snapshot_id="version-1",
            node_job_config=WorkflowNodeJobConfig(),
        ),
    ]
    stale_app = _app(app_id="app-stale", name="Stale Workflow", mode=AppMode.ADVANCED_CHAT)
    stale_app.workflow_id = "workflow-stale"
    stale_app.icon = "old"
    stale_app.icon_background = "#F3F4F6"
    stale_app.updated_at = stale_updated_at
    recent_app = _app(app_id="app-recent", name="Recent Workflow", mode=AppMode.ADVANCED_CHAT)
    recent_app.workflow_id = "workflow-recent"
    recent_app.icon_type = IconType.IMAGE
    recent_app.icon = "upload-file-id"
    recent_app.icon_background = "#E0F2FE"
    recent_app.updated_at = recent_updated_at
    session.add_all([*bindings, stale_app, recent_app])
    session.commit()
    service = AgentRosterService(session)

    result = service._load_published_references_by_agent_id(tenant_id="tenant-1", agent_ids=["agent-1"])

    references = result["agent-1"]
    assert [item["app_id"] for item in references] == ["app-recent", "app-stale"]
    assert references[0]["app_icon_type"] == "image"
    assert references[0]["app_icon"] == "upload-file-id"
    assert references[0]["app_icon_background"] == "#E0F2FE"
    assert references[0]["app_updated_at"] == int(recent_updated_at.timestamp())
    assert references[0]["workflow_version"] == "published-recent"


def test_reference_counts_include_draft_and_published_bindings_once_per_app(sqlite_session: Session):
    session = sqlite_session
    bindings = [
        WorkflowAgentNodeBinding(
            tenant_id="tenant-1",
            agent_id="agent-1",
            app_id="app-1",
            workflow_id="workflow-draft",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="node-draft",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            current_snapshot_id="version-1",
            node_job_config=WorkflowNodeJobConfig(),
        ),
        WorkflowAgentNodeBinding(
            tenant_id="tenant-1",
            agent_id="agent-1",
            app_id="app-1",
            workflow_id="workflow-published",
            workflow_version="v1",
            node_id="node-published",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            current_snapshot_id="version-1",
            node_job_config=WorkflowNodeJobConfig(),
        ),
        WorkflowAgentNodeBinding(
            tenant_id="tenant-1",
            agent_id="agent-1",
            app_id="app-2",
            workflow_id="workflow-stale",
            workflow_version="old-version",
            node_id="node-stale",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            current_snapshot_id="version-1",
            node_job_config=WorkflowNodeJobConfig(),
        ),
    ]
    app_one = _app(app_id="app-1", mode=AppMode.ADVANCED_CHAT)
    app_one.workflow_id = "workflow-published"
    app_two = _app(app_id="app-2", mode=AppMode.ADVANCED_CHAT)
    app_two.workflow_id = "workflow-stale"
    draft_workflow = _workflow(workflow_id="workflow-draft", app_id="app-1")
    published_workflow = _workflow(workflow_id="workflow-published", app_id="app-1")
    published_workflow.version = "v1"
    stale_workflow = _workflow(workflow_id="workflow-stale", app_id="app-2")
    stale_workflow.version = "current-version"
    session.add_all([*bindings, app_one, app_two, draft_workflow, published_workflow, stale_workflow])
    session.commit()
    service = AgentRosterService(session)

    result = service._load_reference_counts_by_agent_id(tenant_id="tenant-1", agent_ids=["agent-1"])

    assert result == {"agent-1": 1}


def test_roster_update_versions_and_detail(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    listed_version = AgentConfigSnapshot(
        id="version-4",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=4,
        config_snapshot=AgentSoulConfig(),
    )
    listed_version_created_at = datetime(2026, 1, 5, 3, 4, 5, tzinfo=UTC)
    listed_version.created_at = listed_version_created_at
    older_listed_version = AgentConfigSnapshot(
        id="version-2",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=2,
        config_snapshot='{"prompt":{}}',
    )
    older_listed_version.created_at = datetime(2026, 1, 4, 3, 4, 5, tzinfo=UTC)
    revision_created_at = datetime(2026, 1, 6, 3, 4, 5, tzinfo=UTC)
    revision = AgentConfigRevision(
        id="revision-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        previous_snapshot_id=None,
        current_snapshot_id="version-2",
        revision=1,
        operation=AgentConfigRevisionOperation.SAVE_NEW_VERSION,
        summary=None,
        version_note=None,
        created_by="account-1",
    )
    revision.created_at = revision_created_at
    listed_revision = AgentConfigRevision(
        tenant_id="tenant-1",
        agent_id="agent-1",
        previous_snapshot_id="version-2",
        current_snapshot_id="version-4",
        revision=2,
        operation=AgentConfigRevisionOperation.SAVE_NEW_VERSION,
        created_by="account-1",
    )
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Analyst",
        description="old",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    session.add_all([agent, listed_version, older_listed_version, revision, listed_revision])
    session.commit()
    service = AgentRosterService(session)
    monkeypatch.setattr(
        service,
        "get_roster_agent_detail",
        lambda **kwargs: {"id": kwargs["agent_id"], "description": agent.description},
    )

    updated = service.update_roster_agent(
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
        payload=roster_service.RosterAgentUpdatePayload(description="new"),
    )
    versions = service.list_agent_versions(tenant_id="tenant-1", agent_id="agent-1")
    detail = service.get_agent_version_detail(tenant_id="tenant-1", agent_id="agent-1", version_id="version-2")

    assert updated["description"] == "new"
    assert versions[0]["id"] == "version-4"
    assert versions[0]["version"] == 2
    assert versions[0]["display_version"] == 2
    assert versions[0]["snapshot_version"] == 4
    assert versions[1]["id"] == "version-2"
    assert versions[1]["version"] == 1
    assert versions[1]["snapshot_version"] == 2
    assert versions[0]["created_at"] == int(listed_version_created_at.timestamp())
    assert detail["version"] == 1
    assert detail["display_version"] == 1
    assert detail["snapshot_version"] == 2
    assert detail["config_snapshot"] == {"prompt": {}}
    assert detail["created_at"] == int(older_listed_version.created_at.timestamp())
    assert detail["revisions"][0]["created_at"] == int(revision_created_at.timestamp())


def test_roster_create_detail_and_lookup_helpers(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    session = sqlite_session
    service = AgentRosterService(session)
    monkeypatch.setattr(
        AgentRosterService,
        "_get_or_create_agent_app_debug_conversation",
        lambda self, *, agent, account_id, draft_type: "debug-conversation-1",
    )
    payload = roster_service.RosterAgentCreatePayload(
        name="Analyst",
        description="desc",
        role="Research assistant",
        icon_type="emoji",
        icon="A",
        icon_background="#fff",
        agent_soul=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "x"}}),
        version_note="initial",
    )

    created = service.create_roster_agent(tenant_id="tenant-1", account_id="account-1", payload=payload)
    backing_agent = service.create_backing_agent_for_app(
        tenant_id="tenant-1",
        account_id="account-1",
        app_id="app-1",
        name="Backing Agent",
        role="Support agent",
    )
    found_agent = service._get_agent(tenant_id="tenant-1", agent_id=created.id)
    with pytest.raises(roster_service.AgentNotFoundError):
        service._get_agent(tenant_id="tenant-1", agent_id="missing")
    found_version = service._get_version(
        tenant_id="tenant-1",
        agent_id=created.id,
        version_id=created.active_config_snapshot_id,
    )
    with pytest.raises(roster_service.AgentVersionNotFoundError):
        service._get_version(tenant_id="tenant-1", agent_id=created.id, version_id=None)
    loaded_versions = service._load_versions_by_id([created.active_config_snapshot_id])
    assert service._load_versions_by_id([]) == {}

    assert created.name == "Analyst"
    assert created.role == "Research assistant"
    assert created.source == AgentSource.ROSTER
    assert created.active_config_snapshot_id is not None
    snapshots = list(
        session.scalars(
            select(AgentConfigSnapshot)
            .where(AgentConfigSnapshot.agent_id.in_([created.id, backing_agent.id]))
            .order_by(AgentConfigSnapshot.agent_id)
        )
    )
    assert [snapshot.home_snapshot_id for snapshot in snapshots] == [None, None]
    assert created.active_config_has_model is False
    assert backing_agent.role == "Support agent"
    assert backing_agent.active_config_snapshot_id is not None
    assert backing_agent.active_config_has_model is False
    assert found_agent.id == created.id
    assert found_version.id == created.active_config_snapshot_id
    assert loaded_versions[created.active_config_snapshot_id].agent_id == created.id


def test_get_agent_runtime_app_model_creates_hidden_backing_app_for_existing_inline_agent(sqlite_session: Session):
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        app_id="workflow-app-1",
        workflow_id="workflow-1",
        workflow_node_id="node-1",
        name="Inline Agent",
        description="desc",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
        created_by="account-1",
        updated_by="account-1",
    )
    session.add(agent)
    session.commit()
    service = AgentRosterService(session)

    resolved_app = service.get_agent_runtime_app_model(tenant_id="tenant-1", agent_id="agent-1")

    assert resolved_app.id == agent.backing_app_id
    assert resolved_app.enable_site is False
    assert resolved_app.enable_api is False
    assert session.get(App, resolved_app.id) is resolved_app


def test_agent_app_build_conversation_create_reuse_and_recreate(sqlite_session: Session):
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        app_id="app-1",
        name="Analyst",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    session.add(agent)
    session.commit()
    service = AgentRosterService(session)

    created_id = service.get_or_create_build_conversation(
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )
    created_conversation = session.get(Conversation, created_id)
    created_mapping = session.scalar(
        select(AgentDebugConversation).where(
            AgentDebugConversation.agent_id == agent.id,
            AgentDebugConversation.account_id == "account-1",
            AgentDebugConversation.draft_type == AgentConfigDraftType.DEBUG_BUILD,
        )
    )
    assert created_conversation is not None
    assert created_mapping is not None
    assert created_id == created_mapping.conversation_id
    assert created_conversation.app_id == "app-1"
    assert created_conversation.from_account_id == "account-1"
    assert created_mapping.tenant_id == "tenant-1"
    assert created_mapping.agent_id == "agent-1"
    assert created_mapping.account_id == "account-1"
    assert created_mapping.draft_type == AgentConfigDraftType.DEBUG_BUILD

    reused_id = service.get_or_create_build_conversation(
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )
    assert reused_id == created_id

    created_conversation.is_deleted = True
    session.commit()
    recreated_id = service.get_or_create_build_conversation(
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )
    assert recreated_id == created_mapping.conversation_id
    assert recreated_id != created_id
    assert session.get(Conversation, recreated_id) is not None


def test_agent_app_debug_conversations_are_isolated_by_draft_type(sqlite_session: Session):
    session = sqlite_session
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        app_id="app-1",
        name="Analyst",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    session.add(agent)
    session.commit()
    service = AgentRosterService(session)

    build_conversation_id = service.get_or_create_build_conversation(
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )
    preview_conversation_id = service.rotate_preview_conversation(
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
    )

    mappings = list(session.scalars(select(AgentDebugConversation).where(AgentDebugConversation.agent_id == agent.id)))
    assert build_conversation_id != preview_conversation_id
    assert {mapping.draft_type for mapping in mappings} == {
        AgentConfigDraftType.DRAFT,
        AgentConfigDraftType.DEBUG_BUILD,
    }


def test_agent_app_debug_conversation_message_count(sqlite_session: Session):
    session = sqlite_session
    for index in range(3):
        session.add(
            Message(
                id=f"message-{index}",
                app_id="app-1",
                conversation_id="debug-conversation-1",
                _inputs={},
                query="q",
                message={},
                message_unit_price=0,
                answer="a",
                answer_unit_price=0,
                total_price=0,
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
                from_account_id="account-1",
                app_mode=AppMode.AGENT_CHAT,
            )
        )
    session.commit()

    count = AgentRosterService(session).count_agent_app_debug_conversation_messages(
        conversation_id="debug-conversation-1",
    )

    assert count == 3


def test_agent_app_debug_conversation_requires_app_binding(sqlite_session: Session):
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        app_id=None,
        name="Analyst",
        description="",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )

    with pytest.raises(roster_service.AgentNotFoundError):
        AgentRosterService(sqlite_session)._get_or_create_agent_app_debug_conversation(
            agent=agent,
            account_id="account-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
        )


def test_load_or_create_build_conversations_supports_runtime_backed_agents(sqlite_session: Session):
    session = sqlite_session
    valid_agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        app_id="app-1",
        name="Analyst",
        description="",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    wrong_tenant_agent = Agent(
        id="agent-2",
        tenant_id="tenant-2",
        app_id="app-2",
        name="Other tenant",
        description="",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
    )
    workflow_agent = Agent(
        id="agent-3",
        tenant_id="tenant-1",
        app_id=None,
        name="Workflow only",
        description="",
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
        workflow_id="workflow-1",
        workflow_node_id="node-1",
    )

    session.add_all([valid_agent, wrong_tenant_agent, workflow_agent])
    session.commit()
    result = AgentRosterService(session).load_or_create_build_conversation_ids_by_agent_id(
        tenant_id="tenant-1",
        agents=[valid_agent, wrong_tenant_agent, workflow_agent],
        account_id="account-1",
    )

    assert list(result) == ["agent-1", "agent-3"]
    assert result["agent-1"]
    assert result["agent-3"]
    mappings = list(
        session.scalars(select(AgentDebugConversation).where(AgentDebugConversation.tenant_id == "tenant-1"))
    )
    assert len(mappings) == 2
    assert all(mapping.draft_type == AgentConfigDraftType.DEBUG_BUILD for mapping in mappings)


def test_agent_app_visible_versions_exclude_draft_saves():
    agent_app = Agent(source=AgentSource.AGENT_APP)
    roster_agent = Agent(source=AgentSource.ROSTER)

    agent_app_operations = AgentRosterService._visible_version_operations(agent_app)
    roster_operations = AgentRosterService._visible_version_operations(roster_agent)

    assert agent_app_operations == {
        AgentConfigRevisionOperation.PUBLISH_DRAFT,
        AgentConfigRevisionOperation.SAVE_NEW_VERSION,
        AgentConfigRevisionOperation.SAVE_TO_ROSTER,
        AgentConfigRevisionOperation.RESTORE_VERSION,
    }
    assert AgentConfigRevisionOperation.SAVE_CURRENT_VERSION not in agent_app_operations
    assert AgentConfigRevisionOperation.CREATE_VERSION in roster_operations
    assert AgentConfigRevisionOperation.RESTORE_VERSION in roster_operations
    assert AgentConfigRevisionOperation.SAVE_CURRENT_VERSION not in roster_operations


def test_restore_roster_agent_version_switches_active_snapshot(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    service = AgentRosterService(session)
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Analyst",
        description="old",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="version-4",
        active_config_is_published=True,
    )
    version = AgentConfigSnapshot(
        id="version-2",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=2,
        home_snapshot_id="home-version-2",
        config_snapshot=_agent_soul_with_model(),
    )
    revision = AgentConfigRevision(
        tenant_id="tenant-1",
        agent_id=agent.id,
        current_snapshot_id=version.id,
        revision=1,
        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
    )
    session.add_all([agent, version, revision])
    session.commit()

    restored = service.restore_agent_version(
        tenant_id="tenant-1",
        agent_id="agent-1",
        version_id="version-2",
        account_id="account-1",
    )

    assert restored == {
        "result": "success",
        "active_config_snapshot_id": "version-4",
        "draft_config_id": restored["draft_config_id"],
        "restored_version_id": "version-2",
    }
    assert agent.active_config_snapshot_id == "version-4"
    assert agent.active_config_is_published is False
    assert agent.updated_by == "account-1"
    draft = session.get(AgentConfigDraft, restored["draft_config_id"])
    assert draft is not None
    assert draft.tenant_id == "tenant-1"
    assert draft.agent_id == "agent-1"
    assert draft.draft_type == AgentConfigDraftType.DRAFT
    assert draft.base_snapshot_id == "version-2"
    assert draft.home_snapshot_id == "home-version-2"
    assert draft.config_snapshot_dict == _agent_soul_with_model().model_dump(mode="json")
    assert draft.updated_by == "account-1"


def test_restore_roster_agent_version_rejects_invisible_versions(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    service = AgentRosterService(session)
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Analyst",
        description="old",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        active_config_snapshot_id="version-4",
    )
    version = AgentConfigSnapshot(
        id="version-2",
        tenant_id="tenant-1",
        agent_id=agent.id,
        version=2,
        config_snapshot=_agent_soul_with_model(),
    )
    session.add_all([agent, version])
    session.commit()

    with pytest.raises(roster_service.AgentVersionNotFoundError):
        service.restore_agent_version(
            tenant_id="tenant-1",
            agent_id="agent-1",
            version_id="version-2",
            account_id="account-1",
        )

    assert agent.active_config_snapshot_id == "version-4"
    assert session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == agent.id)) is None


def test_app_list_all_excludes_agent_apps_by_default(sqlite_session: Session):
    filters = AppService._build_app_list_filters("account-1", "tenant-1", AppListParams(mode="all"), sqlite_session)
    sql = " ".join(str(filter_) for filter_ in filters)

    assert "apps.mode != :mode_1" in sql


def test_app_list_agent_mode_requires_visible_roster_backing_agent(sqlite_session: Session):
    filters = AppService._build_app_list_filters("account-1", "tenant-1", AppListParams(mode="agent"), sqlite_session)
    sql = " ".join(str(filter_) for filter_ in filters)

    assert "EXISTS" in sql
    assert "agents.app_id = apps.id" in sql
    assert "agents.scope" in sql
    assert "agents.source" in sql


def test_validator_dict_helpers_wrap_validation_errors():
    valid_soul = ComposerConfigValidator.validate_agent_soul_dict({"prompt": {"system_prompt": "x"}})
    valid_node_job = ComposerConfigValidator.validate_node_job_dict({"workflow_prompt": "x"})

    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict({"prompt": "not-a-dict"})
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_node_job_dict({"declared_outputs": [{"type": "string"}]})

    assert valid_soul.prompt.system_prompt == "x"
    assert valid_node_job.workflow_prompt == "x"


def test_composer_validator_rejects_stage_4_declared_output_violations():
    """Stage 4 §10.1: the model-layer validators surface stage-4-specific
    violations through InvalidComposerConfigError so the Composer save endpoint
    reports them with the same error shape as other shape failures.
    """
    # Output name violates the JSON-schema-friendly identifier pattern.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_node_job_dict({"declared_outputs": [{"name": "1bad", "type": "string"}]})

    # Output check is enabled on a non-file output.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_node_job_dict(
            {
                "declared_outputs": [
                    {
                        "name": "summary",
                        "type": "string",
                        "check": {
                            "enabled": True,
                            "prompt": "p",
                            "benchmark_file_ref": {"file_id": "f"},
                        },
                    }
                ]
            }
        )

    # default_value shape doesn't match the declared type.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_node_job_dict(
            {
                "declared_outputs": [
                    {
                        "name": "score",
                        "type": "number",
                        "failure_strategy": {
                            "on_failure": "default_value",
                            "default_value": "not a number",
                        },
                    }
                ]
            }
        )

    for reserved_name in ("text", "switch", "_session"):
        with pytest.raises(InvalidComposerConfigError, match="reserved"):
            ComposerConfigValidator.validate_node_job_dict(
                {"declared_outputs": [{"name": reserved_name, "type": "string"}]}
            )

    ComposerConfigValidator.validate_node_job_dict(
        {
            "declared_outputs": [
                {"name": "files", "type": "string"},
                {"name": "json", "type": "string"},
            ]
        }
    )

    # Nested array_item is rejected outright.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_node_job_dict(
            {"declared_outputs": [{"name": "matrix", "type": "array", "array_item": {"type": "array"}}]}
        )


def test_composer_validator_rejects_invalid_shell_env_and_cli():
    """ENG-367/368: env/secret names must be valid shell identifiers (no collisions),
    and an enabled CLI tool must declare a name or install command — caught at composer
    save instead of failing later in the agent backend shell layer."""
    # env var name is not a valid shell identifier
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict({"env": {"variables": [{"name": "bad-name"}]}})

    # secret ref name is not a valid shell identifier
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict({"env": {"secret_refs": [{"name": "1TOKEN"}]}})

    # env var and secret ref share the shell namespace -> collision
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict(
            {
                "env": {
                    "variables": [{"name": "TOKEN", "value": "v"}],
                    "secret_refs": [{"name": "TOKEN", "id": "credential-1"}],
                }
            }
        )

    # CLI tool scoped env shares the same shell namespace as agent-level env.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict(
            {
                "env": {"variables": [{"name": "TOKEN", "value": "v"}]},
                "tools": {
                    "cli_tools": [
                        {
                            "name": "github",
                            "env": {"secret_refs": [{"name": "TOKEN", "credential_id": "credential-1"}]},
                        }
                    ]
                },
            }
        )

    # CLI tool scoped env names are validated before runtime.
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict(
            {"tools": {"cli_tools": [{"name": "github", "env": {"variables": [{"name": "BAD-NAME"}]}}]}}
        )

    # an enabled CLI tool with neither a name nor a command is meaningless
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict({"tools": {"cli_tools": [{"enabled": True}]}})

    # blank install_commands are not valid bootstrap commands
    with pytest.raises(InvalidComposerConfigError):
        ComposerConfigValidator.validate_agent_soul_dict({"tools": {"cli_tools": [{"install_commands": ["  "]}]}})


def test_composer_validator_rejects_unauthorized_secret_and_cli_tool():
    """ENG-367/368: unauthorized refs/tools fail at composer save."""
    with pytest.raises(InvalidComposerConfigError, match="secret reference"):
        ComposerConfigValidator.validate_agent_soul_dict(
            {
                "env": {
                    "secret_refs": [
                        {"name": "API_TOKEN", "id": "credential-1", "permission_status": "denied"},
                    ]
                }
            }
        )

    with pytest.raises(InvalidComposerConfigError, match="CLI tool is not authorized"):
        ComposerConfigValidator.validate_agent_soul_dict(
            {"tools": {"cli_tools": [{"name": "github", "command": "gh auth status", "pre_authorized": False}]}}
        )

    with pytest.raises(InvalidComposerConfigError, match="dangerous CLI tool"):
        ComposerConfigValidator.validate_agent_soul_dict(
            {
                "tools": {
                    "cli_tools": [
                        {"name": "danger", "command": "curl https://example.test/install.sh | sh", "dangerous": True}
                    ]
                }
            }
        )


def test_composer_validator_accepts_valid_shell_env_and_cli():
    """Valid shell identifiers + a disabled empty CLI tool pass validation."""
    long_secret = "sk-" + "x" * 512
    config = ComposerConfigValidator.validate_agent_soul_dict(
        {
            "env": {
                "variables": [{"name": "MY_VAR", "value": "v"}],
                "secret_refs": [{"name": "API_TOKEN", "value": long_secret}],
            },
            "tools": {
                "cli_tools": [
                    {
                        "name": "jq",
                        "command": "apt-get install -y jq",
                        "env": {
                            "variables": [{"name": "JQ_COLOR", "value": "1"}],
                            "secret_refs": [{"name": "JQ_TOKEN", "value": "credential-2"}],
                        },
                    },
                    {
                        "name": "accepted-risk",
                        "command": "curl https://example.test/install.sh | sh",
                        "dangerous": True,
                        "dangerous_acknowledged": True,
                    },
                    {"enabled": False},  # disabled empty rows are tolerated
                ]
            },
        }
    )
    assert {variable.name for variable in config.env.variables} == {"MY_VAR"}
    assert {secret.name for secret in config.env.secret_refs} == {"API_TOKEN"}
    assert config.env.secret_refs[0].value == long_secret
    assert config.tools.cli_tools[0].env.variables[0].name == "JQ_COLOR"
    assert config.tools.cli_tools[0].env.secret_refs[0].name == "JQ_TOKEN"
    assert config.tools.cli_tools[0].env.secret_refs[0].value == "credential-2"


class TestAgentAppBackingAgent:
    """S1: an Agent App (mode=agent) is backed 1:1 by a roster Agent linked via
    ``Agent.app_id``. ``AppService.create_app`` builds the backing agent inside
    its own transaction, so the helper must add+flush without committing."""

    def test_create_backing_agent_for_app_links_app_and_seeds_default_soul(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        session = sqlite_session
        transaction = session.begin()
        service = AgentRosterService(session)
        agent = service.create_backing_agent_for_app(
            tenant_id="tenant-1",
            account_id="account-1",
            app_id="app-1",
            name="Iris",
            description="clarifier",
            role="research assistant",
        )

        # Agent is bound to the app and is a roster/agent_app entry.
        assert agent.app_id == "app-1"
        assert agent.scope == AgentScope.ROSTER
        assert agent.source == AgentSource.AGENT_APP
        assert agent.status == AgentStatus.ACTIVE
        assert agent.agent_kind == AgentKind.DIFY_AGENT
        assert agent.name == "Iris"
        assert agent.role == "research assistant"
        # A v1 snapshot + revision are seeded and wired as the active version.
        snapshots = list(session.scalars(select(AgentConfigSnapshot).where(AgentConfigSnapshot.agent_id == agent.id)))
        assert len(snapshots) == 1
        assert snapshots[0].version == 1
        assert snapshots[0].home_snapshot_id is None
        assert agent.active_config_snapshot_id == snapshots[0].id
        revisions = list(
            session.scalars(
                select(AgentConfigRevision).where(
                    AgentConfigRevision.agent_id == agent.id,
                    AgentConfigRevision.operation == AgentConfigRevisionOperation.CREATE_VERSION,
                )
            )
        )
        assert len(revisions) == 1
        conversations = list(session.scalars(select(Conversation).where(Conversation.app_id == "app-1")))
        assert len(conversations) == 1
        assert conversations[0].app_id == "app-1"
        assert conversations[0].mode == "agent"
        assert conversations[0].status == ConversationStatus.NORMAL
        assert conversations[0].from_source == ConversationFromSource.CONSOLE
        assert conversations[0].from_account_id == "account-1"
        debug_mappings = list(
            session.scalars(select(AgentDebugConversation).where(AgentDebugConversation.agent_id == agent.id))
        )
        assert len(debug_mappings) == 1
        assert debug_mappings[0].tenant_id == "tenant-1"
        assert debug_mappings[0].agent_id == agent.id
        assert debug_mappings[0].app_id == "app-1"
        assert debug_mappings[0].account_id == "account-1"
        assert debug_mappings[0].conversation_id == conversations[0].id
        # Caller (AppService.create_app) owns the commit — helper must not commit.
        assert transaction.is_active

    def test_get_app_backing_agent_queries_active_agent_app_agent(self, sqlite_session: Session):
        session = sqlite_session
        agent = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
        session.add(agent)
        session.commit()
        service = AgentRosterService(session)

        result = service.get_app_backing_agent(tenant_id="tenant-1", app_id="app-1")

        assert result is agent

    def test_get_app_backing_agent_returns_none_when_unbound(self, sqlite_session: Session):
        session = sqlite_session
        service = AgentRosterService(session)

        assert service.get_app_backing_agent(tenant_id="tenant-1", app_id="app-x") is None

    def test_get_agent_app_model_resolves_app_backing_agent(self, sqlite_session: Session):
        session = sqlite_session
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Iris",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            app_id="app-1",
        )
        app = _app(mode=AppMode.AGENT)
        session.add_all([agent, app])
        session.commit()
        service = AgentRosterService(session)

        assert service.get_agent_app_model(tenant_id="tenant-1", agent_id="agent-1") is app

    def test_get_agent_app_model_rejects_unbound_agent(self, sqlite_session: Session):
        session = sqlite_session
        service = AgentRosterService(session)

        with pytest.raises(roster_service.AgentNotFoundError):
            service.get_agent_app_model(tenant_id="tenant-1", agent_id="agent-x")

    def test_reset_build_conversation_creates_mapping(self, sqlite_session: Session):
        session = sqlite_session
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Iris",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            app_id="app-1",
        )
        session.add(agent)
        session.commit()
        service = AgentRosterService(session)

        conversation_id = service.reset_build_conversation(
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="account-1",
        )

        conversations = list(session.scalars(select(Conversation).where(Conversation.id == conversation_id)))
        assert len(conversations) == 1
        assert conversations[0].id == conversation_id
        assert conversations[0].app_id == "app-1"
        assert conversations[0].from_source == ConversationFromSource.CONSOLE
        assert conversations[0].from_account_id == "account-1"
        mappings = list(
            session.scalars(select(AgentDebugConversation).where(AgentDebugConversation.agent_id == agent.id))
        )
        assert len(mappings) == 1
        assert mappings[0].tenant_id == "tenant-1"
        assert mappings[0].agent_id == "agent-1"
        assert mappings[0].app_id == "app-1"
        assert mappings[0].account_id == "account-1"
        assert mappings[0].draft_type == AgentConfigDraftType.DEBUG_BUILD
        assert mappings[0].conversation_id == conversation_id

    def test_rotate_preview_conversation_retires_exact_binding(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        session = sqlite_session
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Iris",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            app_id="app-1",
        )
        mapping = AgentDebugConversation(
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            app_id="old-app",
            account_id="account-1",
            draft_type=AgentConfigDraftType.DRAFT,
            conversation_id="old-conversation",
        )
        previous_conversation = _conversation(conversation_id="old-conversation")
        previous_conversation.app_id = "old-app"
        previous_conversation.agent_workspace_binding_id = "binding-1"
        binding = SimpleNamespace(agent_id=agent.id)
        session.add_all([agent, mapping, previous_conversation])
        session.commit()
        service = AgentRosterService(session)
        events: list[str] = []
        event.listen(session, "after_commit", lambda _session: events.append("commit"))
        get_active_binding = MagicMock(return_value=binding)
        retire_binding = MagicMock(side_effect=lambda **_kwargs: events.append("retire") or "binding-1")
        monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active_binding)
        monkeypatch.setattr(AgentWorkspaceService, "retire_binding", retire_binding)
        monkeypatch.setattr(
            roster_service,
            "enqueue_agent_resource_collection",
            MagicMock(side_effect=lambda **_kwargs: events.append("enqueue")),
        )

        conversation_id = service.rotate_preview_conversation(
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="account-1",
        )

        assert mapping.app_id == "app-1"
        assert mapping.conversation_id == conversation_id
        conversations = list(session.scalars(select(Conversation).where(Conversation.id == conversation_id)))
        assert len(conversations) == 1
        assert conversations[0].id == conversation_id
        assert events == ["retire", "commit", "enqueue"]
        owner_scope = get_active_binding.call_args.kwargs["expected_owner_scope"]
        assert owner_scope.owner_type is AgentWorkspaceOwnerType.CONVERSATION
        assert owner_scope.owner_id == previous_conversation.id
        retire_binding.assert_called_once_with(
            session=session,
            tenant_id="tenant-1",
            binding_id="binding-1",
        )

    def test_reset_build_conversation_retires_build_draft_binding(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        session = sqlite_session
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Iris",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            app_id="app-1",
        )
        mapping = AgentDebugConversation(
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            app_id="app-1",
            account_id="account-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            conversation_id="old-build-conversation",
        )
        build_draft = AgentConfigDraft(
            id="build-draft-1",
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-1",
            draft_owner_key="account-1",
            agent_workspace_binding_id="binding-1",
            config_snapshot=AgentSoulConfig(),
        )
        session.add_all([agent, mapping, build_draft])
        session.commit()
        get_active_binding = MagicMock(return_value=SimpleNamespace(agent_id=agent.id))
        retire_binding = MagicMock(return_value="binding-1")
        enqueue_collection = MagicMock()
        monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active_binding)
        monkeypatch.setattr(AgentWorkspaceService, "retire_binding", retire_binding)
        monkeypatch.setattr(roster_service, "enqueue_agent_resource_collection", enqueue_collection)

        conversation_id = AgentRosterService(session).reset_build_conversation(
            tenant_id="tenant-1",
            agent_id=agent.id,
            account_id="account-1",
        )

        assert mapping.conversation_id == conversation_id
        assert build_draft.agent_workspace_binding_id is None
        owner_scope = get_active_binding.call_args.kwargs["expected_owner_scope"]
        assert owner_scope.owner_type is AgentWorkspaceOwnerType.BUILD_DRAFT
        assert owner_scope.owner_id == build_draft.id
        retire_binding.assert_called_once_with(
            session=session,
            tenant_id="tenant-1",
            binding_id="binding-1",
        )
        enqueue_collection.assert_called_once_with(
            tenant_id="tenant-1",
            binding_ids=("binding-1",),
        )

    def test_preview_rotation_commit_failure_rolls_back_before_enqueue(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        session = sqlite_session
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Iris",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            app_id="app-1",
        )
        mapping = AgentDebugConversation(
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            app_id="app-1",
            account_id="account-1",
            draft_type=AgentConfigDraftType.DRAFT,
            conversation_id="old-conversation",
        )
        previous_conversation = _conversation(conversation_id="old-conversation")
        previous_conversation.agent_workspace_binding_id = "binding-1"
        session.add_all([agent, mapping, previous_conversation])
        session.commit()
        event.listen(
            session,
            "before_commit",
            lambda _session: (_ for _ in ()).throw(RuntimeError("commit failed")),
        )
        monkeypatch.setattr(
            AgentWorkspaceService,
            "get_active_binding",
            MagicMock(return_value=SimpleNamespace(agent_id=agent.id)),
        )
        monkeypatch.setattr(AgentWorkspaceService, "retire_binding", MagicMock(return_value="binding-1"))
        enqueue_collection = MagicMock()
        monkeypatch.setattr(roster_service, "enqueue_agent_resource_collection", enqueue_collection)

        with pytest.raises(RuntimeError, match="commit failed"):
            AgentRosterService(session).rotate_preview_conversation(
                tenant_id="tenant-1",
                agent_id="agent-1",
                account_id="account-1",
            )

        assert session.get(AgentDebugConversation, mapping.id).conversation_id == "old-conversation"
        enqueue_collection.assert_not_called()

    def test_build_reset_commit_failure_rolls_back_before_enqueue(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        session = sqlite_session
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Iris",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            app_id="app-1",
        )
        mapping = AgentDebugConversation(
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            app_id="app-1",
            account_id="account-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            conversation_id="old-build-conversation",
        )
        build_draft = AgentConfigDraft(
            id="build-draft-1",
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-1",
            draft_owner_key="account-1",
            agent_workspace_binding_id="binding-1",
            config_snapshot=AgentSoulConfig(),
        )
        session.add_all([agent, mapping, build_draft])
        session.commit()
        events: list[str] = []

        def fail_commit(_session: Session) -> None:
            assert build_draft.agent_workspace_binding_id is None
            events.append("commit")
            raise RuntimeError("commit failed")

        def rollback(_session: Session) -> None:
            events.append("rollback")

        event.listen(session, "before_commit", fail_commit)
        event.listen(session, "after_rollback", rollback)
        get_active_binding = MagicMock(return_value=SimpleNamespace(agent_id=agent.id))
        monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_active_binding)
        retire_binding = MagicMock(side_effect=lambda **_kwargs: events.append("retire") or "binding-1")
        monkeypatch.setattr(AgentWorkspaceService, "retire_binding", retire_binding)
        enqueue_collection = MagicMock()
        monkeypatch.setattr(roster_service, "enqueue_agent_resource_collection", enqueue_collection)

        with pytest.raises(RuntimeError, match="commit failed"):
            AgentRosterService(session).reset_build_conversation(
                tenant_id="tenant-1",
                agent_id=agent.id,
                account_id="account-1",
            )

        assert events == ["retire", "commit", "rollback"]
        owner_scope = get_active_binding.call_args.kwargs["expected_owner_scope"]
        assert owner_scope.owner_type is AgentWorkspaceOwnerType.BUILD_DRAFT
        assert owner_scope.owner_id == build_draft.id
        retire_binding.assert_called_once_with(
            session=session,
            tenant_id="tenant-1",
            binding_id="binding-1",
        )
        enqueue_collection.assert_not_called()

    def test_duplicate_agent_app_copies_app_config_and_active_soul(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        source_config = SimpleNamespace(
            opening_statement="hello",
            suggested_questions='["q1"]',
            suggested_questions_after_answer='{"enabled": true}',
            speech_to_text='{"enabled": false}',
            text_to_speech='{"enabled": false}',
            more_like_this='{"enabled": false}',
            model=None,
            user_input_form=None,
            dataset_query_variable=None,
            pre_prompt=None,
            agent_mode=None,
            sensitive_word_avoidance=None,
            retriever_resource='{"enabled": true}',
            prompt_type="simple",
            chat_prompt_config=None,
            completion_prompt_config=None,
            dataset_configs=None,
            external_data_tools=None,
            file_upload='{"image": {"enabled": true}}',
        )
        target_config = SimpleNamespace(**dict.fromkeys(AgentRosterService._APP_MODEL_CONFIG_COPY_FIELDS))
        source_app = SimpleNamespace(
            id="source-app",
            tenant_id="tenant-1",
            name="Iris",
            description="source desc",
            icon_type="emoji",
            icon="robot",
            icon_background="#fff",
            api_rph=1,
            api_rpm=2,
            max_active_requests=3,
            enable_site=False,
            enable_api=True,
            use_icon_as_answer_icon=True,
            tracing="{}",
            app_model_config=source_config,
            app_model_config_with_session=lambda *, session: source_config,
        )
        target_app = SimpleNamespace(
            id="target-app",
            app_model_config=target_config,
            app_model_config_with_session=lambda *, session: target_config,
            enable_site=False,
            enable_api=False,
            use_icon_as_answer_icon=False,
            tracing=None,
        )
        source_agent = Agent(
            id="source-agent",
            tenant_id="tenant-1",
            name="Iris",
            description="source desc",
            role="Analyst",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            app_id="source-app",
            active_config_snapshot_id="source-version",
            active_config_has_model=True,
            active_config_is_published=True,
        )
        source_version = AgentConfigSnapshot(
            id="source-version",
            tenant_id="tenant-1",
            agent_id="source-agent",
            version=1,
            home_snapshot_id="home-source",
            config_snapshot=_agent_soul_with_model(),
            summary="configured",
            version_note="v1",
            created_by="account-1",
        )
        session = sqlite_session
        service = AgentRosterService(session)
        captured: dict[str, object] = {}

        class FakeAppService:
            def create_app(self, tenant_id: str, params, account: object, *, session) -> object:
                captured["tenant_id"] = tenant_id
                captured["params"] = params
                captured["account"] = account
                target_agent = AgentRosterService(session).create_backing_agent_for_app(
                    tenant_id=tenant_id,
                    account_id="account-1",
                    app_id=target_app.id,
                    name=params.name,
                    description=params.description,
                    role=params.agent_role,
                )
                target_version = session.scalar(
                    select(AgentConfigSnapshot).where(AgentConfigSnapshot.agent_id == target_agent.id)
                )
                assert target_version is not None
                captured["target_agent"] = target_agent
                captured["target_version"] = target_version
                return target_app

        monkeypatch.setattr(roster_service, "AppService", FakeAppService)
        monkeypatch.setattr(
            AgentRosterService,
            "_get_or_create_agent_app_debug_conversation",
            lambda _self, **_kwargs: None,
        )
        monkeypatch.setattr(service, "get_agent_app_model", lambda **_kwargs: source_app)
        monkeypatch.setattr(
            service,
            "get_app_backing_agent",
            lambda *, tenant_id, app_id: (
                source_agent
                if app_id == source_app.id
                else session.scalar(select(Agent).where(Agent.tenant_id == tenant_id, Agent.app_id == app_id))
            ),
        )
        monkeypatch.setattr(
            service,
            "_get_version",
            lambda *, version_id, **_kwargs: (
                source_version if version_id == source_version.id else session.get(AgentConfigSnapshot, version_id)
            ),
        )
        monkeypatch.setattr(service, "_next_duplicate_agent_name", lambda **_kwargs: "Iris copy")
        monkeypatch.setattr(
            roster_service.FeatureService,
            "get_system_features",
            lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
        )

        account = SimpleNamespace(id="account-1")
        duplicated = service.duplicate_agent_app(
            tenant_id="tenant-1",
            agent_id="source-agent",
            account=account,
        )

        assert duplicated is target_app
        params = captured["params"]
        assert params.name == "Iris copy"
        assert params.mode == "agent"
        assert params.agent_role == "Analyst"
        assert target_app.enable_site is False
        assert target_app.enable_api is False
        assert target_app.use_icon_as_answer_icon is True
        assert target_app.tracing == "{}"
        assert target_config.opening_statement == "hello"
        assert target_config.file_upload == '{"image": {"enabled": true}}'
        assert target_config.updated_by == "account-1"
        target_agent = captured["target_agent"]
        target_version = captured["target_version"]
        assert target_version.config_snapshot.model.model == "gpt-4o"
        assert source_version.home_snapshot_id == "home-source"
        assert target_version.home_snapshot_id is None
        assert target_version.summary == "configured"
        assert target_version.version_note == "v1"
        assert target_agent.active_config_has_model is True
        assert target_agent.active_config_is_published is False
        assert target_agent.updated_by == "account-1"
        assert session.get(Agent, target_agent.id) is target_agent

    def test_duplicate_agent_app_inherits_webapp_access_mode(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        source_app = SimpleNamespace(
            id="source-app",
            tenant_id="tenant-1",
            name="Iris",
            description="source desc",
            icon_type=None,
            icon="robot",
            icon_background="#fff",
            api_rph=1,
            api_rpm=2,
            max_active_requests=3,
            enable_site=True,
            enable_api=True,
            use_icon_as_answer_icon=False,
            tracing=None,
        )
        source_agent = SimpleNamespace(id="source-agent", role="Analyst")
        target_app = SimpleNamespace(id="target-app")
        session = sqlite_session
        service = AgentRosterService(session)
        monkeypatch.setattr(service, "get_agent_app_model", lambda **_: source_app)
        monkeypatch.setattr(service, "get_app_backing_agent", lambda **_: source_agent)
        monkeypatch.setattr(service, "_copy_app_model_config", lambda **_: None)
        monkeypatch.setattr(service, "_copy_agent_active_snapshot", lambda **_: None)
        monkeypatch.setattr(service, "_next_duplicate_agent_name", lambda **_: "Iris copy")

        captured: dict[str, object] = {}

        class FakeAppService:
            def create_app(self, tenant_id: str, params, account: object, *, session) -> object:
                captured["params"] = params
                return target_app

        access_mode_updates = []

        class FakeWebAppAuth:
            @classmethod
            def get_app_access_mode_by_id(cls, app_id: str) -> object:
                return SimpleNamespace(access_mode="private")

            @classmethod
            def update_app_access_mode(cls, app_id: str, access_mode: str) -> None:
                access_mode_updates.append((app_id, access_mode))

        monkeypatch.setattr(roster_service, "AppService", FakeAppService)
        monkeypatch.setattr(
            roster_service.FeatureService,
            "get_system_features",
            lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=True)),
        )
        monkeypatch.setattr(roster_service.EnterpriseService, "WebAppAuth", FakeWebAppAuth)

        duplicated = service.duplicate_agent_app(
            tenant_id="tenant-1",
            agent_id="source-agent",
            account=SimpleNamespace(id="account-1"),
            role="Custom Analyst",
        )

        assert duplicated is target_app
        assert captured["params"].agent_role == "Custom Analyst"
        assert access_mode_updates == [("target-app", "private")]

    def test_duplicate_agent_app_falls_back_to_public_access_mode(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
        source_app = SimpleNamespace(
            id="source-app",
            tenant_id="tenant-1",
            name="Iris",
            description="source desc",
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#fff",
            api_rph=1,
            api_rpm=2,
            max_active_requests=3,
            enable_site=True,
            enable_api=True,
            use_icon_as_answer_icon=False,
            tracing=None,
        )
        source_agent = SimpleNamespace(id="source-agent", role="Analyst")
        target_app = SimpleNamespace(id="target-app")
        session = sqlite_session
        service = AgentRosterService(session)
        monkeypatch.setattr(service, "get_agent_app_model", lambda **_: source_app)
        monkeypatch.setattr(service, "get_app_backing_agent", lambda **_: source_agent)
        monkeypatch.setattr(service, "_copy_app_model_config", lambda **_: None)
        monkeypatch.setattr(service, "_copy_agent_active_snapshot", lambda **_: None)
        monkeypatch.setattr(service, "_next_duplicate_agent_name", lambda **_: "Iris copy")

        class FakeAppService:
            def create_app(self, tenant_id: str, params, account: object, *, session) -> object:
                return target_app

        access_mode_updates = []

        class FakeWebAppAuth:
            @classmethod
            def get_app_access_mode_by_id(cls, app_id: str) -> object:
                raise ValueError("not found")

            @classmethod
            def update_app_access_mode(cls, app_id: str, access_mode: str) -> None:
                access_mode_updates.append((app_id, access_mode))

        monkeypatch.setattr(roster_service, "AppService", FakeAppService)
        monkeypatch.setattr(
            roster_service.FeatureService,
            "get_system_features",
            lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=True)),
        )
        monkeypatch.setattr(roster_service.EnterpriseService, "WebAppAuth", FakeWebAppAuth)

        service.duplicate_agent_app(
            tenant_id="tenant-1",
            agent_id="source-agent",
            account=SimpleNamespace(id="account-1"),
        )

        assert access_mode_updates == [("target-app", "public")]

    def test_normalize_app_icon_type(self):
        assert AgentRosterService._normalize_app_icon_type(None) is None
        assert AgentRosterService._normalize_app_icon_type(IconType.EMOJI) == "emoji"
        assert AgentRosterService._normalize_app_icon_type("image") == "image"


class TestListWorkflowsReferencingAppAgent:
    def test_groups_bindings_by_workflow_app_and_sorts_by_name(self, sqlite_session: Session):
        session = sqlite_session
        agent = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
        bindings = [
            WorkflowAgentNodeBinding(
                tenant_id="tenant-1",
                agent_id="agent-1",
                app_id="wf-app-1",
                workflow_id="wf-1",
                workflow_version="v1",
                node_id="node-b",
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                current_snapshot_id="version-1",
                node_job_config=WorkflowNodeJobConfig(),
            ),
            WorkflowAgentNodeBinding(
                tenant_id="tenant-1",
                agent_id="agent-1",
                app_id="wf-app-1",
                workflow_id="wf-1",
                workflow_version="v1",
                node_id="node-a",
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                current_snapshot_id="version-1",
                node_job_config=WorkflowNodeJobConfig(),
            ),
            WorkflowAgentNodeBinding(
                tenant_id="tenant-1",
                agent_id="agent-1",
                app_id="wf-app-2",
                workflow_id="wf-2",
                workflow_version="v2",
                node_id="node-a",
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                current_snapshot_id="version-1",
                node_job_config=WorkflowNodeJobConfig(),
            ),
        ]
        beta_app = _app(app_id="wf-app-1", name="Beta Flow", mode=AppMode.WORKFLOW)
        beta_app.workflow_id = "wf-1"
        alpha_app = _app(app_id="wf-app-2", name="Alpha Flow", mode=AppMode.ADVANCED_CHAT)
        alpha_app.workflow_id = "wf-2"
        session.add_all([agent, *bindings, beta_app, alpha_app])
        session.commit()
        service = AgentRosterService(session)

        result = service.list_workflows_referencing_app_agent(tenant_id="tenant-1", app_id="app-1")

        assert [r["app_name"] for r in result] == ["Alpha Flow", "Beta Flow"]
        beta = next(r for r in result if r["app_id"] == "wf-app-1")
        assert beta["node_ids"] == ["node-a", "node-b"]  # deduped + sorted
        assert beta["workflow_id"] == "wf-1"
        assert beta["workflow_version"] == "v1"

    def test_returns_empty_when_no_backing_agent(self, sqlite_session: Session):
        session = sqlite_session  # scalar() -> None
        service = AgentRosterService(session)

        assert service.list_workflows_referencing_app_agent(tenant_id="tenant-1", app_id="app-x") == []

    def test_returns_empty_when_no_bindings(self, sqlite_session: Session):
        session = sqlite_session
        session.add(_agent(source=AgentSource.AGENT_APP, app_id="app-1"))
        session.commit()
        service = AgentRosterService(session)

        assert service.list_workflows_referencing_app_agent(tenant_id="tenant-1", app_id="app-1") == []

    def test_skips_orphaned_binding_whose_app_is_gone(self, sqlite_session: Session):
        session = sqlite_session
        agent = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
        binding = WorkflowAgentNodeBinding(
            tenant_id="tenant-1",
            agent_id=agent.id,
            app_id="wf-app-gone",
            workflow_id="wf-9",
            workflow_version="v9",
            node_id="node-a",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            current_snapshot_id="version-1",
            node_job_config=WorkflowNodeJobConfig(),
        )
        session.add_all([agent, binding])
        session.commit()
        service = AgentRosterService(session)

        assert service.list_workflows_referencing_app_agent(tenant_id="tenant-1", app_id="app-1") == []

    def test_skips_historical_published_workflow_versions(self, sqlite_session: Session):
        session = sqlite_session
        agent = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
        bindings = [
            WorkflowAgentNodeBinding(
                tenant_id="tenant-1",
                agent_id=agent.id,
                app_id="wf-app-1",
                workflow_id="old-wf",
                workflow_version="old",
                node_id="old",
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                current_snapshot_id="version-1",
                node_job_config=WorkflowNodeJobConfig(),
            ),
            WorkflowAgentNodeBinding(
                tenant_id="tenant-1",
                agent_id=agent.id,
                app_id="wf-app-1",
                workflow_id="current-wf",
                workflow_version="v2",
                node_id="new",
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                current_snapshot_id="version-1",
                node_job_config=WorkflowNodeJobConfig(),
            ),
        ]
        app = _app(app_id="wf-app-1", name="Flow", mode=AppMode.WORKFLOW)
        app.workflow_id = "current-wf"
        session.add_all([agent, *bindings, app])
        session.commit()
        service = AgentRosterService(session)

        result = service.list_workflows_referencing_app_agent(tenant_id="tenant-1", app_id="app-1")

        assert len(result) == 1
        assert result[0]["workflow_id"] == "current-wf"
        assert result[0]["node_ids"] == ["new"]


class TestWorkflowAgentDraftBindingSync:
    def _agent_workflow(self) -> Workflow:
        workflow = _workflow()
        workflow.graph = json.dumps(
            {
                "nodes": [
                    {
                        "id": "agent-node",
                        "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"},
                    }
                ],
                "edges": [],
            }
        )
        return workflow

    def _agent_binding(self) -> WorkflowAgentNodeBinding:
        return WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            node_job_config=WorkflowNodeJobConfig(),
        )

    def _publish_agent(self) -> Agent:
        return Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Iris",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="snapshot-1",
        )

    def _snapshot(self, agent_soul: AgentSoulConfig) -> AgentConfigSnapshot:
        return AgentConfigSnapshot(
            id="snapshot-1",
            tenant_id="tenant-1",
            agent_id="agent-1",
            version=1,
            config_snapshot=agent_soul,
        )

    def _publish_revision(self, snapshot_id: str = "snapshot-2") -> AgentConfigRevision:
        return AgentConfigRevision(
            id="revision-1",
            tenant_id="tenant-1",
            agent_id="agent-1",
            current_snapshot_id=snapshot_id,
            revision=1,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
            created_by="account-1",
        )

    def _sync_roster_agent_task_refs(
        self,
        *,
        agent_task: str,
        existing_ref_selectors: list[list[str]] | None = None,
        sqlite_session: Session,
    ) -> WorkflowNodeJobConfig:
        workflow = _workflow()
        workflow.graph = json.dumps(
            {
                "nodes": [
                    {
                        "id": "agent-node",
                        "data": {
                            "type": "agent",
                            "version": "2",
                            "agent_node_kind": "dify_agent",
                            "agent_task": agent_task,
                            "agent_binding": {
                                "binding_type": "roster_agent",
                                "agent_id": "agent-1",
                            },
                        },
                    }
                ]
            }
        )
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Agent",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="snapshot-2",
        )
        session = sqlite_session
        existing_binding = None
        if existing_ref_selectors is not None:
            existing_binding = WorkflowAgentNodeBinding(
                id="binding-1",
                tenant_id="tenant-1",
                app_id="app-1",
                workflow_id="workflow-1",
                workflow_version=Workflow.VERSION_DRAFT,
                node_id="agent-node",
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                agent_id="agent-1",
                current_snapshot_id="snapshot-1",
                node_job_config=WorkflowNodeJobConfig.model_validate(
                    {
                        "workflow_prompt": "Old prompt",
                        "previous_node_output_refs": [{"selector": selector} for selector in existing_ref_selectors],
                    }
                ),
            )
        session.add_all([agent, self._publish_revision()])
        if existing_binding is not None:
            session.add(existing_binding)
        session.commit()

        WorkflowAgentPublishService.sync_roster_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        binding = existing_binding or session.scalar(
            select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "agent-node")
        )
        assert binding is not None
        return WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)

    def test_publish_validation_rejects_agent_soul_publish_only_errors(self, sqlite_session: Session):
        session = sqlite_session
        binding = self._agent_binding()
        agent_soul = AgentSoulConfig.model_validate(
            {
                "model": {
                    "plugin_id": "langgenius/openai/openai",
                    "model_provider": "openai",
                    "model": "gpt-4o",
                },
                "prompt": {"system_prompt": "no human reference yet"},
                "human": {"contacts": [{"id": "human-1", "name": "Reviewer"}]},
            }
        )
        agent = self._publish_agent()
        snapshot = self._snapshot(agent_soul)
        session.add_all([binding, agent, snapshot])
        session.commit()

        with pytest.raises(InvalidComposerConfigError, match="human_involvement_not_referenced"):
            WorkflowAgentPublishService.validate_agent_nodes_for_publish(
                session=session,
                draft_workflow=self._agent_workflow(),
            )

    def test_publish_validation_rejects_dangling_agent_soul_config_refs(self, sqlite_session: Session):
        session = sqlite_session
        binding = self._agent_binding()
        agent_soul = AgentSoulConfig.model_validate(
            {
                "model": {
                    "plugin_id": "langgenius/openai/openai",
                    "model_provider": "openai",
                    "model": "gpt-4o",
                },
                "prompt": {"system_prompt": "Use [§skill:research:Research§]."},
            }
        )
        agent = self._publish_agent()
        snapshot = self._snapshot(agent_soul)
        session.add_all([binding, agent, snapshot])
        session.commit()

        with pytest.raises(WorkflowAgentNodeValidationError, match="skill_ref_dangling"):
            WorkflowAgentPublishService.validate_agent_nodes_for_publish(
                session=session,
                draft_workflow=self._agent_workflow(),
            )

    def test_publish_validation_rejects_missing_config_assets(self):
        payload = ComposerSavePayload.model_validate(
            {
                "variant": "agent_app",
                "save_strategy": "save_as_new_version",
                "agent_soul": {
                    "config_skills": [{"name": "research", "file_id": "", "is_missing": True}],
                    "config_files": [
                        {
                            "name": "guide.txt",
                            "file_kind": "upload_file",
                            "file_id": "",
                            "is_missing": True,
                        }
                    ],
                },
            }
        )

        with pytest.raises(InvalidComposerConfigError, match="config_asset_missing.*skill:research.*file:guide.txt"):
            ComposerConfigValidator.validate_publish_payload(payload)

    def test_projects_binding_declared_outputs_to_draft_graph_response(self, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_binding": {
                                    "binding_type": "roster_agent",
                                    "agent_id": "agent-1",
                                },
                            },
                        }
                    ],
                    "edges": [],
                }
            ),
        )
        binding = WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            node_job_config=WorkflowNodeJobConfig(
                workflow_prompt="Summarize the upstream result.",
                declared_outputs=[
                    DeclaredOutputConfig(name="summary", type=DeclaredOutputType.STRING, description="Short summary"),
                    DeclaredOutputConfig(
                        name="profile",
                        type=DeclaredOutputType.OBJECT,
                        children=[
                            DeclaredOutputChildConfig(name="email", type=DeclaredOutputType.STRING),
                            DeclaredOutputChildConfig(
                                name="addresses",
                                type=DeclaredOutputType.ARRAY,
                                array_item=DeclaredArrayItem(
                                    type=DeclaredOutputType.OBJECT,
                                    children=[DeclaredOutputChildConfig(name="city", type=DeclaredOutputType.STRING)],
                                ),
                            ),
                        ],
                    ),
                ],
            ),
        )
        session.add(binding)
        session.commit()

        graph = WorkflowAgentPublishService.project_draft_bindings_to_graph(
            session=session,
            draft_workflow=workflow,
        )

        node_data = graph["nodes"][0]["data"]
        assert node_data["agent_binding"] == {
            "binding_type": "roster_agent",
            "agent_id": "agent-1",
            "current_snapshot_id": "snapshot-1",
        }
        assert node_data["agent_task"] == "Summarize the upstream result."
        assert node_data["agent_declared_outputs"][0]["name"] == "summary"
        assert node_data["agent_declared_outputs"][0]["type"] == "string"
        assert node_data["agent_declared_outputs"][0]["description"] == "Short summary"
        profile_output = node_data["agent_declared_outputs"][1]
        assert profile_output["children"][0]["name"] == "email"
        assert profile_output["children"][1]["array_item"]["children"][0]["name"] == "city"
        assert "agent_declared_outputs" not in workflow.graph_dict["nodes"][0]["data"]

    def test_projects_inline_binding_over_pending_inline_graph_response(self, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                },
                            },
                        }
                    ],
                    "edges": [],
                }
            ),
        )
        binding = WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id="inline-agent-1",
            current_snapshot_id="inline-snapshot-1",
            node_job_config=WorkflowNodeJobConfig(),
        )
        session.add(binding)
        session.commit()

        graph = WorkflowAgentPublishService.project_draft_bindings_to_graph(
            session=session,
            draft_workflow=workflow,
        )

        assert graph["nodes"][0]["data"]["agent_binding"] == {
            "binding_type": "inline_agent",
            "agent_id": "inline-agent-1",
            "current_snapshot_id": "inline-snapshot-1",
        }
        assert workflow.graph_dict["nodes"][0]["data"]["agent_binding"] == {
            "binding_type": "inline_agent",
        }

    def test_keeps_pending_inline_graph_response_over_existing_roster_binding(self, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                },
                            },
                        }
                    ],
                    "edges": [],
                }
            ),
        )
        binding = WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            node_job_config=WorkflowNodeJobConfig(),
        )
        session.add(binding)
        session.commit()

        graph = WorkflowAgentPublishService.project_draft_bindings_to_graph(
            session=session,
            draft_workflow=workflow,
        )

        assert graph["nodes"][0]["data"]["agent_binding"] == {
            "binding_type": "inline_agent",
        }

    def test_creates_roster_binding_from_agent_node_graph(self, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_task": "Summarize the upstream result.",
                                "agent_declared_outputs": [
                                    {
                                        "name": "summary",
                                        "type": "string",
                                        "description": "Short summary",
                                    }
                                ],
                                "agent_binding": {
                                    "binding_type": "roster_agent",
                                    "agent_id": "agent-1",
                                },
                            },
                        }
                    ]
                }
            ),
        )
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Agent",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="snapshot-2",
        )
        session.add_all([agent, self._publish_revision()])
        session.commit()

        WorkflowAgentPublishService.sync_roster_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        binding = session.scalar(
            select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "agent-node")
        )
        assert binding is not None
        assert binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
        assert binding.agent_id == "agent-1"
        assert binding.current_snapshot_id == "snapshot-2"
        assert binding.node_job_config_dict == WorkflowNodeJobConfig(
            workflow_prompt="Summarize the upstream result.",
            declared_outputs=[
                DeclaredOutputConfig(
                    name="summary",
                    type=DeclaredOutputType.STRING,
                    description="Short summary",
                )
            ],
        ).model_dump(mode="json")

    @pytest.mark.parametrize("reserved_name", ["text", "switch", "_session"])
    def test_rejects_reserved_output_names_from_agent_node_graph(self, reserved_name: str):
        with pytest.raises(ValueError, match="invalid agent_declared_outputs"):
            WorkflowAgentPublishService._node_job_config_from_node_data(
                existing_binding=None,
                node_data={
                    "agent_declared_outputs": [{"name": reserved_name, "type": "string"}],
                },
            )

    @pytest.mark.parametrize("output_name", ["files", "json"])
    def test_accepts_retired_output_names_as_custom_outputs_from_agent_node_graph(self, output_name: str):
        node_job = WorkflowAgentPublishService._node_job_config_from_node_data(
            existing_binding=None,
            node_data={
                "agent_declared_outputs": [{"name": output_name, "type": "string"}],
            },
        )

        assert [output.name for output in node_job.declared_outputs] == [output_name]

    def test_creates_roster_binding_deriving_previous_node_refs_from_agent_task(self, sqlite_session: Session):
        node_job = self._sync_roster_agent_task_refs(
            agent_task="Review {{#previous-node.report#}} for {{#sys.query#}}.",
            sqlite_session=sqlite_session,
        )

        assert node_job.workflow_prompt == "Review {{#previous-node.report#}} for {{#sys.query#}}."
        assert [ref.selector for ref in node_job.previous_node_output_refs] == [["previous-node", "report"]]

    def test_updates_existing_roster_binding_clearing_legacy_only_previous_node_refs(self, sqlite_session: Session):
        node_job = self._sync_roster_agent_task_refs(
            agent_task="Review [§node_output:previous-node.report:PREV/report§].",
            existing_ref_selectors=[["previous-node", "report"]],
            sqlite_session=sqlite_session,
        )

        assert node_job.workflow_prompt == "Review [§node_output:previous-node.report:PREV/report§]."
        assert node_job.previous_node_output_refs == []

    def test_updates_existing_roster_binding_clearing_stale_previous_node_refs(self, sqlite_session: Session):
        node_job = self._sync_roster_agent_task_refs(
            agent_task="Review the current request without upstream context.",
            existing_ref_selectors=[["previous-node", "report"]],
            sqlite_session=sqlite_session,
        )

        assert node_job.workflow_prompt == "Review the current request without upstream context."
        assert node_job.previous_node_output_refs == []

    def test_creates_inline_binding_from_agent_node_graph(self, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_task": "Use the current node context.",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                    "agent_id": "inline-agent-1",
                                    "current_snapshot_id": "inline-snapshot-1",
                                },
                            },
                        }
                    ]
                }
            ),
        )
        agent = Agent(
            id="inline-agent-1",
            tenant_id="tenant-1",
            name="Workflow Agent agent-node",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_node_id="agent-node",
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="inline-snapshot-1",
        )
        snapshot = AgentConfigSnapshot(
            id="inline-snapshot-1",
            tenant_id="tenant-1",
            agent_id="inline-agent-1",
            version=1,
            config_snapshot=AgentSoulConfig(),
        )
        session.add_all([agent, snapshot])
        session.commit()

        WorkflowAgentPublishService.sync_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        binding = session.scalar(
            select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "agent-node")
        )
        assert binding is not None
        assert binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT
        assert binding.agent_id == "inline-agent-1"
        assert binding.current_snapshot_id == "inline-snapshot-1"
        assert binding.node_job_config_dict == WorkflowNodeJobConfig(
            workflow_prompt="Use the current node context.",
        ).model_dump(mode="json")

    def test_keeps_pending_inline_binding_in_draft_graph_without_db_binding(self, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                },
                            },
                        }
                    ]
                }
            ),
        )
        existing_binding = WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            node_job_config=WorkflowNodeJobConfig(),
        )
        session.add(existing_binding)
        session.commit()

        WorkflowAgentPublishService.sync_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        assert session.get(WorkflowAgentNodeBinding, existing_binding.id) is existing_binding
        assert not session.new

    def test_clones_inline_binding_for_agent_owned_by_another_node(self, monkeypatch, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                    "agent_id": "inline-agent-1",
                                    "current_snapshot_id": "inline-snapshot-1",
                                },
                            },
                        }
                    ]
                }
            ),
        )
        agent = Agent(
            id="inline-agent-1",
            tenant_id="tenant-1",
            name="Workflow Agent other-node",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_node_id="other-node",
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="inline-snapshot-1",
        )
        session.add(agent)
        session.commit()
        clone = MagicMock(return_value=(SimpleNamespace(id="cloned-agent"), "cloned-snapshot"))
        monkeypatch.setattr(WorkflowAgentPublishService, "_clone_inline_graph_binding_for_node", clone)

        WorkflowAgentPublishService.sync_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        clone.assert_called_once()
        binding = session.scalar(
            select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "agent-node")
        )
        assert binding is not None
        assert binding.agent_id == "cloned-agent"
        assert binding.current_snapshot_id == "cloned-snapshot"

    def test_rejects_agent_node_graph_binding_with_unsupported_type(self, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_binding": {
                                    "binding_type": "unknown",
                                    "agent_id": "agent-1",
                                },
                            },
                        }
                    ]
                }
            ),
        )

        with pytest.raises(ValueError, match="unsupported agent_binding type"):
            WorkflowAgentPublishService.sync_agent_bindings_for_draft(
                session=session,
                draft_workflow=workflow,
                account_id="account-1",
            )

    def test_treats_partial_inline_binding_as_pending_draft_state(self, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                    "agent_id": "inline-agent-1",
                                },
                            },
                        }
                    ]
                }
            ),
        )

        WorkflowAgentPublishService.sync_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        assert session.scalar(select(WorkflowAgentNodeBinding)) is None

    def test_rejects_inline_binding_with_missing_snapshot(self, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                    "agent_id": "inline-agent-1",
                                    "current_snapshot_id": "missing-snapshot",
                                },
                            },
                        }
                    ]
                }
            ),
        )
        agent = Agent(
            id="inline-agent-1",
            tenant_id="tenant-1",
            name="Workflow Agent agent-node",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_node_id="agent-node",
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="inline-snapshot-1",
        )
        session.add(agent)
        session.commit()

        with pytest.raises(ValueError, match="missing inline agent config snapshot"):
            WorkflowAgentPublishService.sync_agent_bindings_for_draft(
                session=session,
                draft_workflow=workflow,
                account_id="account-1",
            )

    def test_updates_existing_roster_binding_prompt_from_agent_node_graph(self, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_task": "Use the latest tender context.",
                                "agent_binding": {
                                    "binding_type": "roster_agent",
                                    "agent_id": "agent-1",
                                },
                            },
                        }
                    ]
                }
            ),
        )
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Agent",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="snapshot-2",
        )
        existing_binding = WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            node_job_config=WorkflowNodeJobConfig(
                workflow_prompt="Old prompt",
                declared_outputs=[
                    DeclaredOutputConfig(name="summary", type=DeclaredOutputType.STRING, description="Short summary")
                ],
            ),
        )
        session.add_all([agent, self._publish_revision(), existing_binding])
        session.commit()

        WorkflowAgentPublishService.sync_roster_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        node_job = WorkflowNodeJobConfig.model_validate(existing_binding.node_job_config_dict)
        assert node_job.workflow_prompt == "Use the latest tender context."
        assert [output.name for output in node_job.declared_outputs] == ["summary"]
        assert existing_binding.current_snapshot_id == "snapshot-2"

    def test_updates_existing_roster_binding_declared_outputs_from_agent_node_graph(self, sqlite_session: Session):
        session = sqlite_session
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "agent-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_task": "Keep the prompt.",
                                "agent_declared_outputs": [],
                                "agent_binding": {
                                    "binding_type": "roster_agent",
                                    "agent_id": "agent-1",
                                },
                            },
                        }
                    ]
                }
            ),
        )
        agent = Agent(
            id="agent-1",
            tenant_id="tenant-1",
            name="Agent",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="snapshot-2",
        )
        existing_binding = WorkflowAgentNodeBinding(
            id="binding-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            node_job_config=WorkflowNodeJobConfig(
                workflow_prompt="Old prompt",
                declared_outputs=[
                    DeclaredOutputConfig(
                        name="summary",
                        type=DeclaredOutputType.STRING,
                        description="Short summary",
                    )
                ],
            ),
        )
        session.add_all([agent, self._publish_revision(), existing_binding])
        session.commit()

        WorkflowAgentPublishService.sync_roster_agent_bindings_for_draft(
            session=session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        node_job = WorkflowNodeJobConfig.model_validate(existing_binding.node_job_config_dict)
        assert node_job.workflow_prompt == "Keep the prompt."
        assert node_job.declared_outputs == []
        assert existing_binding.current_snapshot_id == "snapshot-2"

    @pytest.mark.parametrize(
        "sqlite_session",
        [(Agent, AgentConfigRevision, AgentConfigSnapshot, WorkflowAgentNodeBinding)],
        indirect=True,
    )
    def test_deletes_draft_binding_and_returns_only_replaced_inline_agent(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ) -> None:
        workflow = Workflow(
            id="workflow-1",
            tenant_id="tenant-1",
            app_id="app-1",
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(
                {
                    "nodes": [
                        {
                            "id": "kept-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                    "agent_id": "inline-kept",
                                    "current_snapshot_id": "snapshot-kept",
                                },
                            },
                        },
                        {
                            "id": "roster-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_binding": {
                                    "binding_type": "roster_agent",
                                    "agent_id": "roster-new",
                                },
                            },
                        },
                        {
                            "id": "inline-replaced-node",
                            "data": {
                                "type": "agent",
                                "version": "2",
                                "agent_node_kind": "dify_agent",
                                "agent_binding": {
                                    "binding_type": "inline_agent",
                                    "agent_id": "inline-new",
                                    "current_snapshot_id": "snapshot-inline-new",
                                },
                            },
                        },
                    ]
                }
            ),
        )
        removed_inline = WorkflowAgentNodeBinding(
            id="binding-inline-removed",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="removed-node",
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id="inline-removed",
            current_snapshot_id="snapshot-removed",
            node_job_config=WorkflowNodeJobConfig(),
        )
        kept_inline = WorkflowAgentNodeBinding(
            id="binding-inline-kept",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="kept-node",
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id="inline-kept",
            current_snapshot_id="snapshot-kept",
            node_job_config=WorkflowNodeJobConfig(),
        )
        removed_roster = WorkflowAgentNodeBinding(
            id="binding-roster-removed",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="removed-roster-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="roster-removed",
            current_snapshot_id="snapshot-roster",
            node_job_config=WorkflowNodeJobConfig(),
        )
        old_inline_replaced_by_roster = WorkflowAgentNodeBinding(
            id="binding-inline-to-roster",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="roster-node",
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id="inline-old-roster",
            current_snapshot_id="snapshot-inline-old-roster",
            node_job_config=WorkflowNodeJobConfig(),
        )
        old_inline_replaced_by_inline = WorkflowAgentNodeBinding(
            id="binding-inline-to-inline",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="inline-replaced-node",
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id="inline-old-inline",
            current_snapshot_id="snapshot-inline-old-inline",
            node_job_config=WorkflowNodeJobConfig(),
        )
        kept_agent = Agent(
            id="inline-kept",
            tenant_id="tenant-1",
            name="Kept inline",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            status=AgentStatus.ACTIVE,
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_node_id="kept-node",
            active_config_snapshot_id="snapshot-kept",
        )
        replacement_agent = Agent(
            id="inline-new",
            tenant_id="tenant-1",
            name="Replacement inline",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            status=AgentStatus.ACTIVE,
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_node_id="inline-replaced-node",
            active_config_snapshot_id="snapshot-inline-new",
        )
        roster_agent = Agent(
            id="roster-new",
            tenant_id="tenant-1",
            name="Roster replacement",
            description="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="snapshot-roster-new",
        )
        kept_snapshot = AgentConfigSnapshot(
            id="snapshot-kept",
            tenant_id="tenant-1",
            agent_id="inline-kept",
            version=1,
            config_snapshot=AgentSoulConfig(),
            home_snapshot_id="home-kept",
        )
        replacement_snapshot = AgentConfigSnapshot(
            id="snapshot-inline-new",
            tenant_id="tenant-1",
            agent_id="inline-new",
            version=1,
            config_snapshot=AgentSoulConfig(),
            home_snapshot_id="home-inline-new",
        )
        sqlite_session.add_all(
            [
                kept_agent,
                replacement_agent,
                roster_agent,
                kept_snapshot,
                replacement_snapshot,
                removed_inline,
                kept_inline,
                removed_roster,
                old_inline_replaced_by_roster,
                old_inline_replaced_by_inline,
            ]
        )
        sqlite_session.commit()
        retirement_candidates = WorkflowAgentPublishService.sync_agent_bindings_for_draft(
            session=sqlite_session,
            draft_workflow=workflow,
            account_id="account-1",
        )

        assert sqlite_session.get(WorkflowAgentNodeBinding, removed_inline.id) is None
        assert sqlite_session.get(WorkflowAgentNodeBinding, removed_roster.id) is None
        assert kept_inline.binding_type == WorkflowAgentBindingType.INLINE_AGENT
        assert kept_inline.agent_id == "inline-kept"
        assert old_inline_replaced_by_roster.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
        assert old_inline_replaced_by_roster.agent_id == "roster-new"
        assert old_inline_replaced_by_roster.current_snapshot_id == "snapshot-roster-new"
        assert old_inline_replaced_by_inline.binding_type == WorkflowAgentBindingType.INLINE_AGENT
        assert old_inline_replaced_by_inline.agent_id == "inline-new"
        assert old_inline_replaced_by_inline.current_snapshot_id == "snapshot-inline-new"
        assert retirement_candidates == {"inline-removed", "inline-old-roster", "inline-old-inline"}


def test_dataset_rows_filters_malformed_ids(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    """Mention ids are user-editable text: a non-UUID id must read as missing
    (placeholder semantics), never reach the UUID-typed dataset query (E2E 500)."""
    captured = {}

    def fake_get_datasets_by_ids(ids, tenant_id, *, session):
        captured["ids"] = ids
        return [], 0

    import services.dataset_service as dataset_service_module
    from services.agent.knowledge_datasets import get_tenant_knowledge_dataset_rows

    monkeypatch.setattr(dataset_service_module.DatasetService, "get_datasets_by_ids", fake_get_datasets_by_ids)

    valid = "550e8400-e29b-41d4-a716-446655440000"
    rows = get_tenant_knowledge_dataset_rows(
        session=sqlite_session, tenant_id="tenant-1", dataset_ids=["9999dead-beef", valid]
    )
    assert rows == {}
    assert captured["ids"] == [valid]

    # all-malformed input never touches the DB
    captured.clear()
    assert get_tenant_knowledge_dataset_rows(session=sqlite_session, tenant_id="tenant-1", dataset_ids=["nope"]) == {}
    assert captured == {}


def test_composer_save_rejects_malformed_knowledge_dataset_ids(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    captured = {"calls": 0}

    def fake_get_datasets_by_ids(ids, tenant_id, *, session):
        captured["calls"] += 1
        captured["ids"] = ids
        captured["tenant_id"] = tenant_id
        return [], 0

    import services.dataset_service as dataset_service_module

    monkeypatch.setattr(dataset_service_module.DatasetService, "get_datasets_by_ids", fake_get_datasets_by_ids)

    agent_soul = AgentSoulConfig.model_validate(
        {
            "knowledge": {
                "sets": [
                    {
                        "id": "support",
                        "name": "Support KB",
                        "datasets": [{"id": "not-a-uuid"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                    }
                ]
            }
        }
    )

    with pytest.raises(InvalidComposerConfigError, match="not-a-uuid"):
        AgentComposerService.validate_knowledge_datasets(
            session=sqlite_session, tenant_id="tenant-1", agent_soul=agent_soul
        )

    assert captured == {"calls": 0}


def test_composer_save_rejects_missing_or_out_of_scope_knowledge_datasets(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    captured = {}
    missing_dataset_id = "550e8400-e29b-41d4-a716-446655440000"

    def fake_get_datasets_by_ids(ids, tenant_id, *, session):
        captured["ids"] = ids
        captured["tenant_id"] = tenant_id
        return [], 0

    import services.dataset_service as dataset_service_module

    monkeypatch.setattr(dataset_service_module.DatasetService, "get_datasets_by_ids", fake_get_datasets_by_ids)

    agent_soul = AgentSoulConfig.model_validate(
        {
            "knowledge": {
                "sets": [
                    {
                        "id": "support",
                        "name": "Support KB",
                        "datasets": [{"id": missing_dataset_id}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                    }
                ]
            }
        }
    )

    with pytest.raises(InvalidComposerConfigError, match=missing_dataset_id):
        AgentComposerService.validate_knowledge_datasets(
            session=sqlite_session, tenant_id="tenant-1", agent_soul=agent_soul
        )

    assert captured == {"ids": [missing_dataset_id], "tenant_id": "tenant-1"}


def test_save_agent_composer_allows_incomplete_knowledge_draft(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    agent = _agent(
        source=AgentSource.AGENT_APP,
        app_id="app-1",
    )
    agent.active_config_snapshot_id = "version-1"
    agent.active_config_is_published = True
    revision = AgentConfigRevision(
        id="revision-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        current_snapshot_id="version-1",
        revision=1,
        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        created_by="account-1",
    )
    session.add_all([agent, revision])
    session.commit()
    active_version = SimpleNamespace(
        home_snapshot_id="home-initial", config_snapshot_dict=AgentSoulConfig().model_dump(mode="json")
    )
    saved = {}
    flushes = 0

    def count_flush(_session: Session, _flush_context: object) -> None:
        nonlocal flushes
        flushes += 1

    event.listen(session, "after_flush", count_flush)

    import services.dataset_service as dataset_service_module

    monkeypatch.setattr(
        dataset_service_module.DatasetService,
        "get_datasets_by_ids",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("draft save must skip dataset lookup")),
    )
    monkeypatch.setattr(
        AgentComposerService,
        "_save_agent_draft",
        lambda **kwargs: saved.update(kwargs) or SimpleNamespace(id="draft-1", home_snapshot_id="home-initial"),
    )
    monkeypatch.setattr(AgentComposerService, "_get_version_if_present", lambda **_kwargs: active_version)
    monkeypatch.setattr(AgentComposerService, "load_agent_composer", lambda **_kwargs: {"loaded": True})

    payload = ComposerSavePayload.model_validate(
        {
            "variant": ComposerVariant.AGENT_APP.value,
            "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
            "agent_soul": {
                "knowledge": {
                    "sets": [
                        {
                            "id": "support",
                            "name": "Support KB",
                            "datasets": [{"id": "not-a-uuid"}],
                            "query": {"mode": "generated_query"},
                            "retrieval": {"mode": "single"},
                            "metadata_filtering": {"mode": "automatic"},
                        }
                    ]
                }
            },
        }
    )

    result = AgentComposerService.save_agent_composer(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
        payload=payload,
    )

    assert result["loaded"] is True
    assert saved["draft_type"] == AgentConfigDraftType.DRAFT
    assert saved["agent_soul"].knowledge.sets[0].retrieval.mode == "single"
    assert saved["agent_soul"].knowledge.sets[0].retrieval.model is None
    assert saved["agent_soul"].knowledge.sets[0].metadata_filtering.mode == "automatic"
    assert saved["agent_soul"].knowledge.sets[0].metadata_filtering.metadata_model_config is None
    assert flushes >= 1
    assert not session.dirty


def test_workspace_dify_tools_returns_provider_and_tool_granularities(monkeypatch: pytest.MonkeyPatch):
    """The slash-menu Tools tab needs both selection granularities: a provider
    hosts many tools (like an MCP server), so candidates return one
    provider-level entry (id = <provider>/*, = all tools) plus one per tool."""
    from types import SimpleNamespace

    provider = SimpleNamespace(
        name="duckduckgo",
        plugin_id="langgenius/duckduckgo",
        label=SimpleNamespace(en_US="DuckDuckGo"),
        description=SimpleNamespace(en_US="Privacy-first web search"),
        tools=[
            SimpleNamespace(name="ddg_search", label=SimpleNamespace(en_US="DuckDuckGo Search")),
            SimpleNamespace(name="ddg_news", label=SimpleNamespace(en_US="DuckDuckGo News")),
        ],
    )

    import services.tools.builtin_tools_manage_service as builtin_tools_module

    monkeypatch.setattr(
        builtin_tools_module.BuiltinToolManageService,
        "list_builtin_tools",
        staticmethod(lambda user_id, tenant_id: [provider]),
    )

    entries = AgentComposerService._workspace_dify_tools(tenant_id="tenant-1", user_id="user-1")

    assert entries[0] == {
        "id": "duckduckgo/*",
        "granularity": "provider",
        "name": "DuckDuckGo",
        "description": "Privacy-first web search",
        "provider": "duckduckgo",
        "plugin_id": "langgenius/duckduckgo",
        "tools_count": 2,
    }
    assert [entry["id"] for entry in entries[1:]] == ["duckduckgo/ddg_search", "duckduckgo/ddg_news"]
    assert {entry["granularity"] for entry in entries[1:]} == {"tool"}


def test_resolve_workflow_node_agent_id_degrades_without_workflow_or_binding(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    session = sqlite_session
    from types import SimpleNamespace

    def boom(cls, **kwargs):
        raise ValueError("no draft workflow")

    monkeypatch.setattr(AgentComposerService, "_get_draft_workflow", classmethod(boom))
    assert (
        AgentComposerService.resolve_workflow_node_agent_id(session=session, tenant_id="t", app_id="a", node_id="n")
        is None
    )

    monkeypatch.setattr(
        AgentComposerService, "_get_draft_workflow", classmethod(lambda cls, **kwargs: SimpleNamespace(id="wf-1"))
    )
    monkeypatch.setattr(AgentComposerService, "_get_workflow_binding", classmethod(lambda cls, **kwargs: None))
    assert (
        AgentComposerService.resolve_workflow_node_agent_id(session=session, tenant_id="t", app_id="a", node_id="n")
        is None
    )

    monkeypatch.setattr(
        AgentComposerService,
        "_get_workflow_binding",
        classmethod(lambda cls, **kwargs: SimpleNamespace(agent_id="agent-7")),
    )
    assert (
        AgentComposerService.resolve_workflow_node_agent_id(session=session, tenant_id="t", app_id="a", node_id="n")
        == "agent-7"
    )
