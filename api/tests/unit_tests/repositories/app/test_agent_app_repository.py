"""Runtime App materialization must persist or roll back as one transaction."""

from collections.abc import Iterator
from typing import Literal

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.model import App, AppModelConfig
from repositories.app.agent_app_repository import AgentAppRepository
from services.agent.roster_service import AgentRosterService
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.model_billing_dependency_inventory import AgentModelSelectors

type Resolver = Literal["repository", "roster"]


@pytest.mark.usefixtures("_inline_agent")
def test_model_dependency_documents_include_every_owned_agent_snapshot_and_draft_without_materializing_app(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            AgentConfigDraft(
                tenant_id="tenant-1", agent_id="inline-agent", draft_type=AgentConfigDraftType.DRAFT, config_snapshot={}
            )
        )
        session.add_all(
            [
                AgentConfigSnapshot(tenant_id=tenant, agent_id="inline-agent", version=version, config_snapshot={})
                for tenant, version in (("tenant-1", 1), ("tenant-1", 2), ("other", 3))
            ]
        )
    result = AgentAppRepository(session_factory=sqlite_session_factory).collect_model_dependency_documents("tenant-1")
    assert len(result) == 3
    assert all(isinstance(item.payload, AgentModelSelectors) and item.owner_id == "inline-agent" for item in result)
    with sqlite_session_factory() as session:
        assert session.scalar(select(App)) is None


@pytest.mark.usefixtures("_inline_agent")
def test_tracing_owner_rejects_inline_without_materializing_app(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = AgentAppRepository(session_factory=sqlite_session_factory)
    with pytest.raises(AgentAppNotFoundError):
        repository.resolve_roster_app_id(tenant_id="tenant-1", agent_id="inline-agent")
    with sqlite_session_factory() as session:
        assert session.scalar(select(App)) is None
        agent = session.get(Agent, "inline-agent")
        assert agent is not None
        assert agent.backing_app_id is None


@pytest.fixture
def _inline_agent(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            Agent(
                id="inline-agent",
                tenant_id="tenant-1",
                app_id="workflow-app",
                workflow_id="workflow-1",
                workflow_node_id="node-1",
                name="Inline Agent",
                description="Internal runtime",
                agent_kind=AgentKind.DIFY_AGENT,
                scope=AgentScope.WORKFLOW_ONLY,
                source=AgentSource.WORKFLOW,
                status=AgentStatus.ACTIVE,
                created_by="account-1",
                updated_by="account-1",
            )
        )


@pytest.fixture(params=["repository", "roster"])
def resolver(request: pytest.FixtureRequest) -> Resolver:
    return "repository" if request.param == "repository" else "roster"


def resolve_runtime_app(factory: sessionmaker[Session], resolver: Resolver) -> str:
    if resolver == "repository":
        return AgentAppRepository(session_factory=factory).resolve_runtime_app_id(
            tenant_id="tenant-1", agent_id="inline-agent"
        )
    with factory() as session:
        return AgentRosterService(session).get_agent_runtime_app_model(tenant_id="tenant-1", agent_id="inline-agent").id


@pytest.mark.usefixtures("_inline_agent")
def test_runtime_app_creation_commits_all_records_and_reuses_them(
    sqlite_session_factory: sessionmaker[Session], resolver: Resolver
) -> None:
    app_id = resolve_runtime_app(sqlite_session_factory, resolver)
    assert resolve_runtime_app(sqlite_session_factory, resolver) == app_id

    with sqlite_session_factory() as session:
        [agent] = session.scalars(select(Agent)).all()
        [app] = session.scalars(select(App)).all()
        [config] = session.scalars(select(AppModelConfig)).all()
        assert agent.backing_app_id == app.id == config.app_id == app_id
        assert app.app_model_config_id == config.id
        assert app.tenant_id == agent.tenant_id == "tenant-1"
        assert app.created_by == app.updated_by == config.created_by == "account-1"
        assert app.name == "Inline Agent"
        assert not app.enable_api
        assert not app.enable_site
        assert agent.scope == AgentScope.WORKFLOW_ONLY


@pytest.fixture(params=["config-insert", "commit"])
def failed_materialization(
    request: pytest.FixtureRequest, sqlite_session_factory: sessionmaker[Session], _inline_agent: None
) -> Iterator[None]:
    def fail(*_args: object) -> None:
        raise RuntimeError("materialization failed")

    target, event_name = (
        (AppModelConfig, "before_insert")
        if request.param == "config-insert"
        else (sqlite_session_factory, "before_commit")
    )
    event.listen(target, event_name, fail)
    try:
        yield
    finally:
        event.remove(target, event_name, fail)


@pytest.mark.usefixtures("failed_materialization")
def test_runtime_app_creation_failure_rolls_back_all_records(
    sqlite_session_factory: sessionmaker[Session], resolver: Resolver
) -> None:
    with pytest.raises(RuntimeError, match="materialization failed"):
        resolve_runtime_app(sqlite_session_factory, resolver)

    with sqlite_session_factory() as session:
        agent = session.get(Agent, "inline-agent")
        assert agent is not None
        assert agent.backing_app_id is None
        assert session.scalar(select(App)) is None
        assert session.scalar(select(AppModelConfig)) is None


@pytest.mark.usefixtures("_inline_agent")
def test_existing_runtime_app_resolution_does_not_commit_the_callers_transaction(
    sqlite_session_factory: sessionmaker[Session], resolver: Resolver
) -> None:
    app_id = resolve_runtime_app(sqlite_session_factory, resolver)
    with sqlite_session_factory() as session:
        app = session.get(App, app_id)
        assert app is not None
        app.name = "Uncommitted change"
        resolved = AgentRosterService(session).get_agent_runtime_app_model(
            tenant_id="tenant-1", agent_id="inline-agent"
        )
        assert resolved is app
        session.rollback()

    with sqlite_session_factory() as session:
        app = session.get(App, app_id)
        assert app is not None
        assert app.name == "Inline Agent"
