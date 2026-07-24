"""SQLite-backed integration tests for Agent composer, roster, and workflow publishing services.

The service layer accepts caller-owned SQLAlchemy sessions. These tests intentionally use one
isolated database per test and persist complete model graphs instead of fabricating query order.
External compositor, storage, backend-session, and task boundaries remain mocked where needed.
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentDebugConversation,
    AgentDriveFile,
    AgentDriveFileKind,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.base import TypeBase
from models.enums import AppStatus, ConversationFromSource, ConversationStatus
from models.model import App, AppMode, Conversation, IconType, Message
from models.workflow import Workflow, WorkflowType
from services.agent.agent_soul_state import agent_soul_has_model
from services.agent.composer_service import AgentComposerService
from services.agent.errors import (
    AgentNameConflictError,
    AgentNotFoundError,
    AgentVersionNotFoundError,
)
from services.agent.roster_service import AgentRosterService
from services.entities.agent_entities import AgentSoulConfig as ServiceAgentSoulConfig
from services.entities.agent_entities import RosterAgentCreatePayload


@pytest.fixture
def agent_session(sqlite_engine: Engine) -> Iterator[Session]:
    """Yield a real session with only the tables used by these service tests."""

    TypeBase.metadata.create_all(
        sqlite_engine,
        tables=[
            Agent.__table__,
            AgentConfigDraft.__table__,
            AgentConfigSnapshot.__table__,
            AgentConfigRevision.__table__,
            AgentDebugConversation.__table__,
            AgentDriveFile.__table__,
            WorkflowAgentNodeBinding.__table__,
            App.__table__,
            Workflow.__table__,
            Conversation.__table__,
            Message.__table__,
        ],
    )
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with factory() as session:
        yield session


def _soul(*, with_model: bool = True, prompt: str = "") -> AgentSoulConfig:
    payload: dict[str, object] = {"prompt": {"system_prompt": prompt}}
    if with_model:
        payload["model"] = {
            "plugin_id": "langgenius/openai/openai",
            "model_provider": "openai",
            "model": "gpt-4o",
        }
    return AgentSoulConfig.model_validate(payload)


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
) -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id=snapshot_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        version=version,
        config_snapshot=_soul(),
        created_by="account-1",
    )


def _workflow(*, workflow_id: str = "workflow-1", tenant_id: str = "tenant-1") -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id=tenant_id,
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph='{"nodes": [], "edges": []}',
        _features="{}",
        created_by="account-1",
        _environment_variables="{}",
        _conversation_variables="{}",
        _rag_pipeline_variables="{}",
    )


def _binding(*, tenant_id: str = "tenant-1", node_id: str = "node-1") -> WorkflowAgentNodeBinding:
    return WorkflowAgentNodeBinding(
        id=f"binding-{tenant_id}-{node_id}",
        tenant_id=tenant_id,
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version=Workflow.VERSION_DRAFT,
        node_id=node_id,
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig(),
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


def test_agent_soul_has_model() -> None:
    assert agent_soul_has_model(_soul()) is True
    assert agent_soul_has_model(_soul(with_model=False)) is False


def test_composer_lookup_helpers_are_tenant_scoped(agent_session: Session) -> None:
    agent = _agent()
    snapshot = _snapshot()
    other_agent = _agent(agent_id="other-agent", tenant_id="tenant-2", name="Other")
    other_snapshot = _snapshot(snapshot_id="other-snapshot", tenant_id="tenant-2", agent_id=other_agent.id)
    agent_session.add_all([agent, snapshot, other_agent, other_snapshot])
    agent_session.commit()

    assert (
        AgentComposerService._require_agent(tenant_id="tenant-1", agent_id=agent.id, session=agent_session).id
        == agent.id
    )
    assert (
        AgentComposerService._require_version(
            tenant_id="tenant-1", agent_id=agent.id, version_id=snapshot.id, session=agent_session
        ).id
        == snapshot.id
    )
    assert (
        AgentComposerService._get_agent_if_present(tenant_id="tenant-1", agent_id=other_agent.id, session=agent_session)
        is None
    )
    assert (
        AgentComposerService._get_version_if_present(
            tenant_id="tenant-1", agent_id=other_agent.id, version_id=other_snapshot.id, session=agent_session
        )
        is None
    )

    with pytest.raises(AgentNotFoundError):
        AgentComposerService._require_agent(tenant_id="tenant-2", agent_id=agent.id, session=agent_session)
    with pytest.raises(AgentVersionNotFoundError):
        AgentComposerService._require_version(
            tenant_id="tenant-2", agent_id=agent.id, version_id=snapshot.id, session=agent_session
        )


@pytest.mark.parametrize(
    ("draft_type", "account_id"),
    [
        (AgentConfigDraftType.DRAFT, None),
        (AgentConfigDraftType.DEBUG_BUILD, "account-1"),
    ],
)
def test_load_agent_soul_for_debug_selects_requested_draft(
    agent_session: Session,
    draft_type: AgentConfigDraftType,
    account_id: str | None,
) -> None:
    agent = _agent(source=AgentSource.AGENT_APP)
    agent_soul = AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": True}}})
    draft = AgentConfigDraft(
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        draft_type=draft_type,
        account_id=account_id,
        draft_owner_key=account_id or "",
        config_snapshot=agent_soul,
    )
    agent_session.add_all([agent, draft])
    agent_session.commit()

    result = AgentComposerService.load_agent_soul_for_debug(
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        account_id="account-1",
        draft_type=draft_type,
        session=agent_session,
    )

    assert result == agent_soul


def test_load_agent_soul_for_debug_requires_existing_build_draft(agent_session: Session) -> None:
    agent = _agent(source=AgentSource.AGENT_APP)
    agent_session.add(agent)
    agent_session.commit()

    with pytest.raises(AgentVersionNotFoundError):
        AgentComposerService.load_agent_soul_for_debug(
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            account_id="account-1",
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            session=agent_session,
        )


def test_composer_loads_draft_workflow_and_binding_without_published_decoy(agent_session: Session) -> None:
    workflow = _workflow()
    draft_binding = _binding()
    published_binding = _binding(node_id="published-node")
    published_binding.workflow_version = "2026-01-01"
    agent_session.add_all([workflow, draft_binding, published_binding])
    agent_session.commit()

    assert (
        AgentComposerService._get_draft_workflow(tenant_id="tenant-1", app_id="app-1", session=agent_session).id
        == workflow.id
    )
    assert (
        AgentComposerService._get_workflow_binding(
            tenant_id="tenant-1", workflow_id=workflow.id, node_id="node-1", session=agent_session
        ).id
        == draft_binding.id
    )
    assert (
        AgentComposerService._get_workflow_binding(
            tenant_id="tenant-1", workflow_id=workflow.id, node_id="missing", session=agent_session
        )
        is None
    )


def test_roster_create_persists_agent_snapshot_and_revision(agent_session: Session) -> None:
    payload = RosterAgentCreatePayload(
        name="Researcher",
        description="desc",
        role="assistant",
        agent_soul=ServiceAgentSoulConfig.model_validate(_soul().model_dump(mode="json")),
    )

    agent = AgentRosterService(agent_session).create_roster_agent(
        tenant_id="tenant-1", account_id="account-1", payload=payload
    )

    persisted = agent_session.get(Agent, agent.id)
    assert persisted is not None
    assert persisted.active_config_has_model is True
    assert persisted.active_config_is_published is True
    snapshots = agent_session.scalars(select(AgentConfigSnapshot).where(AgentConfigSnapshot.agent_id == agent.id)).all()
    revisions = agent_session.scalars(select(AgentConfigRevision).where(AgentConfigRevision.agent_id == agent.id)).all()
    assert len(snapshots) == 1
    assert [revision.operation for revision in revisions] == [AgentConfigRevisionOperation.CREATE_VERSION]


def test_roster_name_constraint_rolls_back_duplicate(agent_session: Session) -> None:
    service = AgentRosterService(agent_session)
    payload = RosterAgentCreatePayload(
        name="Duplicate",
        description="",
        role="",
        agent_soul=ServiceAgentSoulConfig.model_validate(_soul().model_dump(mode="json")),
    )
    service.create_roster_agent(tenant_id="tenant-1", account_id="account-1", payload=payload)

    with pytest.raises(AgentNameConflictError):
        service.create_roster_agent(tenant_id="tenant-1", account_id="account-2", payload=payload)

    assert agent_session.scalar(select(func.count(Agent.id)).where(Agent.tenant_id == "tenant-1")) == 1
    assert agent_session.scalar(select(func.count(AgentConfigSnapshot.id))) == 1


def test_draft_unique_constraint_rolls_back_duplicate_owner(agent_session: Session) -> None:
    agent_session.add(_agent())
    first = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        config_snapshot=_soul(),
    )
    duplicate = AgentConfigDraft(
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        config_snapshot=_soul(with_model=False),
    )
    agent_session.add(first)
    agent_session.commit()
    agent_session.add(duplicate)
    with pytest.raises(IntegrityError):
        agent_session.commit()
    agent_session.rollback()

    drafts = agent_session.scalars(select(AgentConfigDraft)).all()
    assert [draft.id for draft in drafts] == [first.id]


def test_drive_copy_persists_referenced_rows_and_skips_other_tenant(agent_session: Session) -> None:
    rows = [
        AgentDriveFile(
            tenant_id="tenant-1",
            agent_id="source-agent",
            key="tender/SKILL.md",
            file_kind=AgentDriveFileKind.TOOL_FILE,
            file_id="tool-1",
            value_owned_by_drive=True,
            is_skill=True,
        ),
        AgentDriveFile(
            tenant_id="tenant-1",
            agent_id="source-agent",
            key="tender/scripts/run.sh",
            file_kind=AgentDriveFileKind.TOOL_FILE,
            file_id="tool-2",
            value_owned_by_drive=True,
        ),
        AgentDriveFile(
            tenant_id="tenant-2",
            agent_id="source-agent",
            key="tender/private.txt",
            file_kind=AgentDriveFileKind.TOOL_FILE,
            file_id="tool-3",
        ),
    ]
    agent_session.add_all(rows)
    agent_session.commit()

    AgentComposerService._copy_agent_drive_rows(
        tenant_id="tenant-1",
        source_agent_id="source-agent",
        target_agent_id="target-agent",
        account_id="account-1",
        agent_soul=_soul(prompt="[§skill:tender/SKILL.md:Tender§]"),
        session=agent_session,
    )
    agent_session.commit()

    copied = agent_session.scalars(
        select(AgentDriveFile).where(AgentDriveFile.agent_id == "target-agent").order_by(AgentDriveFile.key)
    ).all()
    assert [row.key for row in copied] == ["tender/SKILL.md", "tender/scripts/run.sh"]
    assert {row.tenant_id for row in copied} == {"tenant-1"}


def test_debug_conversation_lookup_is_account_and_tenant_scoped(agent_session: Session) -> None:
    conversation = _conversation()
    mapping = AgentDebugConversation(
        tenant_id="tenant-1",
        agent_id="agent-1",
        app_id="app-1",
        account_id="account-1",
        conversation_id=conversation.id,
    )
    decoy_conversation = _conversation(conversation_id="conversation-2", account_id="account-2")
    decoy_mapping = AgentDebugConversation(
        tenant_id="tenant-1",
        agent_id="agent-1",
        app_id="app-1",
        account_id="account-2",
        conversation_id=decoy_conversation.id,
    )
    agent_session.add_all([conversation, mapping, decoy_conversation, decoy_mapping])
    agent_session.commit()
    service = AgentRosterService(agent_session)

    assert (
        service.load_agent_app_debug_conversation_id(tenant_id="tenant-1", agent_id="agent-1", account_id="account-1")
        == conversation.id
    )
    assert (
        service.load_agent_app_debug_conversation_id(tenant_id="tenant-2", agent_id="agent-1", account_id="account-1")
        is None
    )
    assert (
        service.load_agent_app_debug_conversation_id(tenant_id="tenant-1", agent_id="agent-1", account_id="missing")
        is None
    )


def test_app_backing_agent_lookup_filters_scope_source_status_and_tenant(agent_session: Session) -> None:
    valid = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
    wrong_tenant = _agent(
        agent_id="other-agent", tenant_id="tenant-2", name="Other", source=AgentSource.AGENT_APP, app_id="app-2"
    )
    archived = _agent(agent_id="archived", name="Archived", source=AgentSource.AGENT_APP, app_id="app-3")
    archived.status = AgentStatus.ARCHIVED
    agent_session.add_all([valid, wrong_tenant, archived])
    agent_session.commit()
    service = AgentRosterService(agent_session)

    assert service.load_app_backing_agents_by_app_id(tenant_id="tenant-1", app_ids=["app-1", "app-2", "app-3"]) == {
        "app-1": valid
    }
    assert service.load_app_backing_agents_by_app_id(tenant_id="tenant-1", app_ids=[]) == {}


def test_get_published_agent_soul_for_app_uses_active_snapshot(agent_session: Session) -> None:
    agent_soul = AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": True}}})
    agent = _agent(source=AgentSource.AGENT_APP, app_id="app-1")
    snapshot = _snapshot(agent_id=agent.id)
    snapshot.config_snapshot = agent_soul
    agent.active_config_snapshot_id = snapshot.id
    agent_session.add_all([agent, snapshot])
    agent_session.commit()

    result = AgentRosterService(agent_session).get_published_agent_soul_for_app(
        tenant_id=agent.tenant_id,
        app_id=agent.app_id or "",
    )

    assert result == agent_soul


def test_get_published_agent_soul_for_app_returns_none_without_backing_agent(agent_session: Session) -> None:
    result = AgentRosterService(agent_session).get_published_agent_soul_for_app(
        tenant_id="tenant-1",
        app_id="legacy-app-1",
    )

    assert result is None


def test_roster_version_helpers_use_real_max_and_scoped_rows(agent_session: Session) -> None:
    agent = _agent()
    snapshot = _snapshot()
    agent_session.add_all([agent, snapshot])
    agent_session.add_all(
        [
            AgentConfigRevision(
                id="revision-1",
                tenant_id="tenant-1",
                agent_id=agent.id,
                current_snapshot_id=snapshot.id,
                revision=1,
                operation=AgentConfigRevisionOperation.CREATE_VERSION,
            ),
            AgentConfigRevision(
                id="revision-2",
                tenant_id="tenant-1",
                agent_id=agent.id,
                current_snapshot_id=snapshot.id,
                revision=4,
                operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
            ),
        ]
    )
    agent_session.commit()
    service = AgentRosterService(agent_session)

    assert service._next_revision(tenant_id="tenant-1", agent_id=agent.id) == 5
    assert service._get_agent(tenant_id="tenant-1", agent_id=agent.id).id == agent.id
    assert service._get_version(tenant_id="tenant-1", agent_id=agent.id, version_id=snapshot.id).id == snapshot.id
    with pytest.raises(AgentNotFoundError):
        service._get_agent(tenant_id="tenant-2", agent_id=agent.id)
    with pytest.raises(AgentVersionNotFoundError):
        service._get_version(tenant_id="tenant-1", agent_id=agent.id, version_id="missing")


def test_debug_conversation_message_count_uses_persisted_rows(agent_session: Session) -> None:
    conversation = _conversation()
    other = _conversation(conversation_id="conversation-2")
    agent_session.add_all([conversation, other])
    agent_session.flush()
    for index in range(2):
        agent_session.add(
            Message(
                id=f"message-{index}",
                app_id="app-1",
                conversation_id=conversation.id,
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
    agent_session.commit()

    service = AgentRosterService(agent_session)
    assert service.count_agent_app_debug_conversation_messages(conversation_id=conversation.id) == 2
    assert service.count_agent_app_debug_conversation_messages(conversation_id=other.id) == 0


def test_persisted_app_and_workflow_rows_keep_agent_references_resolvable(agent_session: Session) -> None:
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Agent App",
        description="",
        mode=AppMode.AGENT_CHAT,
        icon_type=IconType.EMOJI,
        icon="🤖",
        icon_background="#fff",
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=True,
        max_active_requests=None,
        created_by="account-1",
    )
    workflow = _workflow()
    agent = _agent(source=AgentSource.AGENT_APP, app_id=app.id)
    agent.workflow_id = workflow.id
    agent_session.add_all([app, workflow, agent])
    agent_session.commit()

    persisted = agent_session.scalar(
        select(Agent).where(Agent.tenant_id == "tenant-1", Agent.app_id == app.id, Agent.workflow_id == workflow.id)
    )
    assert persisted is not None
    assert persisted.id == agent.id
    assert agent_session.scalar(select(App).where(App.tenant_id == "tenant-2")) is None
