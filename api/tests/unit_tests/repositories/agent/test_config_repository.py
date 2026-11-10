"""Agent draft locking and identity-map refresh regression tests."""

import pytest
from sqlalchemy import Select, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from repositories.agent.config_repository import AgentConfigRepository
from services.agent.errors import AgentNotFoundError

TENANT_ID = "tenant"
ACCOUNT_ID = "account"
AGENT_ID = "agent"
OLD_SNAPSHOT_ID = "snapshot-old"
NEW_SNAPSHOT_ID = "snapshot-new"
DRAFT_ID = "draft"


def soul(prompt: str) -> AgentSoulConfig:
    """Build a valid config whose prompt makes the persisted generation observable."""

    return AgentSoulConfig.model_validate({"prompt": {"system_prompt": prompt}})


def prompt_of(draft: AgentConfigDraft) -> str:
    """Return the prompt stored on an ORM draft without depending on its JSON representation."""

    return AgentSoulConfig.model_validate(draft.config_snapshot_dict).prompt.system_prompt


@pytest.fixture
def sessions(sqlite_session_factory: sessionmaker[Session]) -> sessionmaker[Session]:
    """Seed one workflow Agent with an old Draft and two immutable snapshots."""

    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                Agent(
                    id=AGENT_ID,
                    tenant_id=TENANT_ID,
                    name="Original name",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                    status=AgentStatus.ACTIVE,
                    active_config_snapshot_id=OLD_SNAPSHOT_ID,
                    created_by=ACCOUNT_ID,
                    updated_by=ACCOUNT_ID,
                ),
                AgentConfigSnapshot(
                    id=OLD_SNAPSHOT_ID,
                    tenant_id=TENANT_ID,
                    agent_id=AGENT_ID,
                    version=1,
                    config_snapshot=soul("Old snapshot"),
                    home_snapshot_id="home-old",
                ),
                AgentConfigSnapshot(
                    id=NEW_SNAPSHOT_ID,
                    tenant_id=TENANT_ID,
                    agent_id=AGENT_ID,
                    version=2,
                    config_snapshot=soul("New snapshot"),
                    home_snapshot_id="home-new",
                ),
                AgentConfigDraft(
                    id=DRAFT_ID,
                    tenant_id=TENANT_ID,
                    agent_id=AGENT_ID,
                    draft_type=AgentConfigDraftType.DRAFT,
                    base_snapshot_id=OLD_SNAPSHOT_ID,
                    home_snapshot_id="home-old",
                    config_snapshot=soul("Old draft"),
                    created_by=ACCOUNT_ID,
                    updated_by=ACCOUNT_ID,
                ),
            ]
        )
    return sqlite_session_factory


def test_get_or_create_draft_refreshes_locked_rows_without_flushing_stale_draft(
    sessions: sessionmaker[Session],
) -> None:
    """The locked read wins over a stale Draft while preserving caller-owned Agent edits."""

    with sessions() as session:
        agent = session.get_one(Agent, AGENT_ID)
        stale_draft = session.get_one(AgentConfigDraft, DRAFT_ID)
        agent.name = "Caller-owned edit"
        stale_draft.config_snapshot = soul("Stale pending edit")

        with sessions.begin() as external_session:
            external_draft = external_session.get_one(AgentConfigDraft, DRAFT_ID)
            external_draft.config_snapshot = soul("Latest database draft")

        statements: list[str] = []

        def record_statement(state: ORMExecuteState) -> None:
            """Capture the real ORM statements so SQLite tests can verify PostgreSQL lock clauses."""

            if isinstance(state.statement, Select):
                statements.append(str(state.statement.compile(dialect=postgresql.dialect())))

        event.listen(session, "do_orm_execute", record_statement)
        try:
            draft = AgentConfigRepository.get_or_create_draft(
                session=session,
                tenant_id=TENANT_ID,
                agent=agent,
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                created_by=ACCOUNT_ID,
            )
        finally:
            event.remove(session, "do_orm_execute", record_statement)

        assert draft is stale_draft
        assert prompt_of(draft) == "Latest database draft"
        assert agent.name == "Caller-owned edit"
        assert any("FROM agents" in query and "FOR UPDATE" in query for query in statements)
        assert any("FROM agent_config_drafts" in query and "FOR UPDATE" in query for query in statements)
        session.commit()

    with sessions() as verification_session:
        assert verification_session.get_one(Agent, AGENT_ID).name == "Caller-owned edit"
        assert prompt_of(verification_session.get_one(AgentConfigDraft, DRAFT_ID)) == "Latest database draft"


def test_get_or_create_draft_refreshes_agent_before_rebasing(sessions: sessionmaker[Session]) -> None:
    """A clean cached Agent is refreshed before its Draft is rebased to the active snapshot."""

    with sessions() as session:
        stale_agent = session.get_one(Agent, AGENT_ID)
        assert stale_agent.active_config_snapshot_id == OLD_SNAPSHOT_ID

        with sessions.begin() as external_session:
            external_agent = external_session.get_one(Agent, AGENT_ID)
            external_agent.active_config_snapshot_id = NEW_SNAPSHOT_ID

        draft = AgentConfigRepository.get_or_create_draft(
            session=session,
            tenant_id=TENANT_ID,
            agent=stale_agent,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            created_by=ACCOUNT_ID,
        )

        assert stale_agent.active_config_snapshot_id == NEW_SNAPSHOT_ID
        assert draft.base_snapshot_id == NEW_SNAPSHOT_ID
        assert draft.home_snapshot_id == "home-new"
        assert prompt_of(draft) == "New snapshot"


def test_get_draft_refreshes_only_when_locking(sessions: sessionmaker[Session]) -> None:
    """Ordinary reads retain local edits, while locked reads replace stale identity-map state."""

    with sessions() as session:
        draft = session.get_one(AgentConfigDraft, DRAFT_ID)
        draft.config_snapshot = soul("Pending local edit")

        ordinary_read = AgentConfigRepository.get_draft(
            session=session,
            tenant_id=TENANT_ID,
            agent_id=AGENT_ID,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
        )

        assert ordinary_read is draft
        assert prompt_of(ordinary_read) == "Pending local edit"
        session.rollback()

        stale_draft = session.get_one(AgentConfigDraft, DRAFT_ID)
        with sessions.begin() as external_session:
            external_draft = external_session.get_one(AgentConfigDraft, DRAFT_ID)
            external_draft.config_snapshot = soul("Latest external edit")

        locked_read = AgentConfigRepository.get_draft(
            session=session,
            tenant_id=TENANT_ID,
            agent_id=AGENT_ID,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            for_update=True,
        )

        assert locked_read is stale_draft
        assert prompt_of(locked_read) == "Latest external edit"


def test_get_or_create_draft_flushes_pending_agent_before_locking(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """A pending Agent becomes lockable even when its caller disabled session autoflush."""

    with sqlite_session_factory() as session, session.no_autoflush:
        agent = Agent(
            id="pending-agent",
            tenant_id=TENANT_ID,
            name="Pending agent",
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
            status=AgentStatus.ACTIVE,
            active_config_snapshot_id="pending-snapshot",
            created_by=ACCOUNT_ID,
        )
        snapshot = AgentConfigSnapshot(
            id="pending-snapshot",
            tenant_id=TENANT_ID,
            agent_id=agent.id,
            version=1,
            config_snapshot=soul("Pending snapshot"),
        )
        session.add(snapshot)
        session.flush([snapshot])
        session.add(agent)

        draft = AgentConfigRepository.get_or_create_draft(
            session=session,
            tenant_id=TENANT_ID,
            agent=agent,
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            created_by=ACCOUNT_ID,
        )

        assert draft.agent_id == agent.id
        assert draft.base_snapshot_id == snapshot.id
        assert prompt_of(draft) == "Pending snapshot"


@pytest.mark.parametrize(("tenant_id", "agent_id"), [("other-tenant", AGENT_ID), (TENANT_ID, "missing-agent")])
def test_get_or_create_draft_requires_parent_in_tenant(
    sessions: sessionmaker[Session], tenant_id: str, agent_id: str
) -> None:
    """A missing or cross-tenant parent fails before any Draft can be returned or created."""

    with sessions() as session:
        agent = session.get_one(Agent, AGENT_ID)
        if agent_id != AGENT_ID:
            with sessions.begin() as external_session:
                external_session.delete(external_session.get_one(Agent, AGENT_ID))

        with pytest.raises(AgentNotFoundError):
            AgentConfigRepository.get_or_create_draft(
                session=session,
                tenant_id=tenant_id,
                agent=agent,
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                created_by=ACCOUNT_ID,
            )
