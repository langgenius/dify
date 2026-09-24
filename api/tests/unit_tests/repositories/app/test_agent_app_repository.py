"""Runtime App materialization must persist or roll back as one transaction."""

from collections.abc import Iterator
from typing import Literal

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from models.agent import Agent, AgentKind, AgentScope, AgentSource, AgentStatus
from models.model import App, AppModelConfig
from repositories.app.agent_app_repository import AgentAppRepository
from services.agent.roster_service import AgentRosterService

type Resolver = Literal["repository", "roster"]


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
