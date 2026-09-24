from collections.abc import Generator
from contextlib import contextmanager, nullcontext
from decimal import Decimal
from typing import cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Table
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql.dml import Delete

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
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus, ConversationFromSource, ConversationStatus
from models.model import App, AppMode, Conversation, Message
from services.agent.deletion_service import AgentDeletionInvariantError, AgentDeletionService


def _archived_agent(
    *,
    agent_id: str = "agent-1",
    tenant_id: str = "tenant-1",
    status: AgentStatus = AgentStatus.ARCHIVED,
) -> Agent:
    return Agent(
        id=agent_id,
        tenant_id=tenant_id,
        name="Agent",
        description="",
        role="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=status,
    )


def test_purge_archived_agent_deletes_complete_aggregate_and_preserves_workflow_binding(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    agent = _archived_agent()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        version=1,
        config_snapshot=AgentSoulConfig(),
    )
    dangling_binding = WorkflowAgentNodeBinding(
        id="workflow-binding-1",
        tenant_id=agent.tenant_id,
        app_id="missing-app",
        workflow_id="missing-workflow",
        workflow_version="old-version",
        node_id="agent-node",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id=agent.id,
        current_snapshot_id=snapshot.id,
        node_job_config={},
    )
    rows = [
        agent,
        snapshot,
        AgentConfigDraft(
            id="draft-1",
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DRAFT,
            draft_owner_key="",
            config_snapshot=AgentSoulConfig(),
        ),
        AgentConfigDraft(
            id="build-1",
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-1",
            draft_owner_key="account-1",
            config_snapshot=AgentSoulConfig(),
        ),
        AgentConfigRevision(
            id="revision-1",
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            current_snapshot_id=snapshot.id,
            revision=1,
            operation=AgentConfigRevisionOperation.CREATE_VERSION,
        ),
        AgentDebugConversation(
            id="debug-1",
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            app_id="app-1",
            account_id="account-1",
            draft_type=AgentConfigDraftType.DRAFT,
            conversation_id="conversation-1",
        ),
        AgentHomeSnapshot(
            id="home-1",
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            snapshot_ref="home-ref",
            status=AgentWorkingResourceStatus.RETIRED,
        ),
        AgentWorkspaceBinding(
            id="binding-1",
            tenant_id=agent.tenant_id,
            app_id="app-1",
            workspace_id="workspace-1",
            agent_id=agent.id,
            agent_config_version_id=snapshot.id,
            agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
            backend_binding_ref="binding-ref",
            status=AgentWorkingResourceStatus.RETIRED,
        ),
    ]
    sibling = _archived_agent(agent_id="agent-2")
    other_tenant = _archived_agent(agent_id="agent-3", tenant_id="tenant-2")
    unrelated_app = App(
        id="unrelated-app",
        tenant_id=agent.tenant_id,
        name="Unrelated",
        mode=AppMode.WORKFLOW,
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=True,
    )
    conversation = Conversation(
        id="conversation-1",
        app_id=unrelated_app.id,
        mode=AppMode.AGENT_CHAT,
        name="Preserved conversation",
        _inputs={},
        status=ConversationStatus.NORMAL,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id="account-1",
    )
    preserved_rows = [
        sibling,
        other_tenant,
        AgentConfigDraft(
            id="sibling-draft",
            tenant_id=sibling.tenant_id,
            agent_id=sibling.id,
            draft_type=AgentConfigDraftType.DRAFT,
            draft_owner_key="",
            config_snapshot=AgentSoulConfig(),
        ),
        AgentHomeSnapshot(
            id="other-home",
            tenant_id=other_tenant.tenant_id,
            agent_id=other_tenant.id,
            snapshot_ref="other-home-ref",
            status=AgentWorkingResourceStatus.RETIRED,
        ),
        unrelated_app,
        AgentWorkspace(
            id="workspace-1",
            tenant_id=agent.tenant_id,
            app_id=unrelated_app.id,
            owner_type=AgentWorkspaceOwnerType.CONVERSATION,
            owner_id=conversation.id,
            owner_scope_key="root",
            backend_workspace_ref="workspace-ref",
            status=AgentWorkingResourceStatus.ACTIVE,
            active_guard=1,
        ),
        conversation,
        Message(
            id="message-1",
            app_id=unrelated_app.id,
            conversation_id=conversation.id,
            _inputs={},
            query="hello",
            message={"role": "user", "content": "hello"},
            answer="world",
            message_unit_price=Decimal(0),
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id="account-1",
        ),
    ]
    sqlite_session.add_all([*rows, dangling_binding, *preserved_rows])
    sqlite_session.commit()
    monkeypatch.setattr(
        "services.agent.deletion_service.session_factory.create_session",
        sqlite_session_factory,
    )

    AgentDeletionService.purge_archived_agents(tenant_id=agent.tenant_id, agent_ids=[agent.id])

    with sqlite_session_factory() as observer_session:
        for row in rows:
            assert observer_session.get(type(row), row.id) is None
        preserved_binding = observer_session.get(WorkflowAgentNodeBinding, dangling_binding.id)
        assert preserved_binding is not None
        assert preserved_binding.agent_id == agent.id
        for row in preserved_rows:
            assert observer_session.get(type(row), row.id) is not None


def test_purge_bulk_deletes_aggregate_dependencies_before_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    context = MagicMock()
    session = context.__enter__.return_value
    session.scalars.return_value.all.return_value = [_archived_agent()]
    session.scalar.side_effect = [None, None]
    deleted_tables: list[str] = []

    def record_bulk_delete(statement: object) -> None:
        if isinstance(statement, Delete):
            deleted_tables.append(cast(Table, statement.table).name)

    session.execute.side_effect = record_bulk_delete
    monkeypatch.setattr("services.agent.deletion_service.session_factory.create_session", lambda: context)
    AgentDeletionService.purge_archived_agents(tenant_id="tenant-1", agent_ids=["agent-1"])

    assert deleted_tables == [
        cast(Table, model.__table__).name
        for model in (
            AgentDebugConversation,
            AgentConfigRevision,
            AgentConfigDraft,
            AgentConfigSnapshot,
            AgentHomeSnapshot,
            AgentWorkspaceBinding,
            Agent,
        )
    ]


@pytest.mark.parametrize(
    ("invariant", "expected_error"),
    [
        ("non_archived", "must be ARCHIVED"),
        ("active_binding", "still has ACTIVE Binding"),
        ("active_home", "still has ACTIVE Home Snapshot"),
    ],
)
def test_purge_rejects_invalid_aggregate_invariants(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    invariant: str,
    expected_error: str,
) -> None:
    agent = _archived_agent(status=AgentStatus.ACTIVE if invariant == "non_archived" else AgentStatus.ARCHIVED)
    related: AgentWorkspaceBinding | AgentHomeSnapshot | None = None
    if invariant == "active_binding":
        related = AgentWorkspaceBinding(
            id="binding-1",
            tenant_id=agent.tenant_id,
            app_id="app-1",
            workspace_id="workspace-1",
            agent_id=agent.id,
            agent_config_version_id="snapshot-1",
            agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
            backend_binding_ref="binding-ref",
            status=AgentWorkingResourceStatus.ACTIVE,
        )
    elif invariant == "active_home":
        related = AgentHomeSnapshot(
            id="home-1",
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            snapshot_ref="home-ref",
            status=AgentWorkingResourceStatus.ACTIVE,
        )
    sqlite_session.add(agent)
    if related is not None:
        sqlite_session.add(related)
    sqlite_session.commit()
    monkeypatch.setattr(
        "services.agent.deletion_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )

    with pytest.raises(AgentDeletionInvariantError, match=expected_error):
        AgentDeletionService.purge_archived_agents(tenant_id=agent.tenant_id, agent_ids=[agent.id])

    assert sqlite_session.get(Agent, agent.id) is not None
    if related is not None:
        assert sqlite_session.get(type(related), related.id) is not None


def test_purge_is_idempotent_for_empty_missing_and_repeated_ids(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    agent = _archived_agent()
    sqlite_session.add(agent)
    sqlite_session.commit()
    monkeypatch.setattr(
        "services.agent.deletion_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )

    agent_id = agent.id

    AgentDeletionService.purge_archived_agents(tenant_id=agent.tenant_id, agent_ids=[])
    assert sqlite_session.get(Agent, agent_id) is not None

    AgentDeletionService.purge_archived_agents(tenant_id=agent.tenant_id, agent_ids=["missing-agent"])
    assert sqlite_session.get(Agent, agent_id) is not None

    AgentDeletionService.purge_archived_agents(tenant_id=agent.tenant_id, agent_ids=[agent_id, agent_id])
    assert sqlite_session.get(Agent, agent_id) is None

    AgentDeletionService.purge_archived_agents(tenant_id=agent.tenant_id, agent_ids=[agent_id])
    assert sqlite_session.get(Agent, agent_id) is None


@pytest.mark.parametrize("failure_stage", ["delete", "commit"])
def test_purge_failure_rolls_back_complete_aggregate(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    failure_stage: str,
) -> None:
    agent = _archived_agent()
    draft = AgentConfigDraft(
        id="draft-1",
        tenant_id=agent.tenant_id,
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        config_snapshot=AgentSoulConfig(),
    )
    sqlite_session.add_all([agent, draft])
    sqlite_session.commit()
    agent_id = agent.id
    draft_id = draft.id
    error = RuntimeError(f"{failure_stage} failed")

    @contextmanager
    def failing_session() -> Generator[Session]:
        with sqlite_session_factory() as service_session:
            failure_method = failure_stage if failure_stage == "commit" else "execute"
            monkeypatch.setattr(service_session, failure_method, MagicMock(side_effect=error))
            yield service_session

    monkeypatch.setattr(
        "services.agent.deletion_service.session_factory.create_session",
        failing_session,
    )

    with pytest.raises(RuntimeError) as exc_info:
        AgentDeletionService.purge_archived_agents(tenant_id=agent.tenant_id, agent_ids=[agent_id])

    assert exc_info.value is error
    with sqlite_session_factory() as observer_session:
        assert observer_session.get(Agent, agent_id) is not None
        assert observer_session.get(AgentConfigDraft, draft_id) is not None
