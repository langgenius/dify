from dataclasses import dataclass, field

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.app import build_app_api_key_service
from machinery.context import RequestContext
from models.agent import Agent, AgentConfigRevision, AgentConfigRevisionOperation, AgentScope, AgentSource, AgentStatus
from models.model import ApiToken, App, AppMode
from repositories.app.api_key_repository import AppApiKeyRepository
from services.app.api_key_service import AppApiKeyNotReadyError, AppApiKeyService
from services.auth.api_key_contracts import ApiKeyNotFoundError, ApiKeyResourceNotFoundError


@dataclass
class ObservingCache:
    session_factory: sessionmaker[Session]
    calls: list[tuple[str, str | None]] = field(default_factory=list)

    def delete(self, token: str, scope: str | None = None) -> bool:
        # A fresh connection must see the deletion before any external cache I/O.
        with self.session_factory() as session:
            assert session.scalar(select(ApiToken).where(ApiToken.token == token)) is None
        self.calls.append((token, scope))
        return True


def test_deletion_invalidates_cache_after_commit_and_not_on_failure(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(
        App(id="app", tenant_id="tenant", name="App", mode=AppMode.CHAT, enable_site=False, enable_api=True)
    )
    sqlite_session.commit()
    context = RequestContext("request", None, "actor", "tenant")
    cache = ObservingCache(sqlite_session_factory)
    service = AppApiKeyService(
        keys=AppApiKeyRepository(session_factory=sqlite_session_factory),
        cache=cache,
    )
    key = service.create_key(context, "app")

    with pytest.raises(ApiKeyNotFoundError):
        service.delete_key(context, "app", "missing")
    assert cache.calls == []

    service.delete_key(context, "app", key.id)
    assert cache.calls == [(key.token, key.type)]
    assert service.list_keys(context, "app") == ()


def test_composition_builds_working_api_key_service(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    sqlite_session.add(
        App(id="app", tenant_id="tenant", name="App", mode=AppMode.CHAT, enable_site=False, enable_api=True)
    )
    sqlite_session.commit()
    service = build_app_api_key_service(database_client=sqlite_session_factory)
    context = RequestContext("request", None, "actor", "tenant")

    key = service.create_key(context, "app")
    assert service.list_keys(context, "app") == (key,)


@pytest.fixture
def service(sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]) -> AppApiKeyService:
    sqlite_session.add(
        App(id="app", tenant_id="tenant", name="App", mode=AppMode.CHAT, enable_site=False, enable_api=True)
    )
    sqlite_session.commit()
    return build_app_api_key_service(database_client=sqlite_session_factory)


def _persist_agent(session: Session) -> Agent:
    app = session.get(App, "app")
    assert app is not None
    app.mode = AppMode.AGENT
    agent = Agent(
        id="agent",
        tenant_id="tenant",
        name="Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id="app",
    )
    session.add(agent)
    session.commit()
    return agent


def test_app_access_check_rejects_foreign_workspace(service: AppApiKeyService, sqlite_session: Session) -> None:
    context = RequestContext("request", None, "actor", "foreign")

    with pytest.raises(ApiKeyResourceNotFoundError, match="App not found"):
        service.create_key(context, "app")

    assert sqlite_session.scalar(select(ApiToken)) is None


@pytest.mark.parametrize("source", [AgentSource.AGENT_APP, AgentSource.IMPORTED])
def test_agent_requires_publish_visible_version_for_creation(
    service: AppApiKeyService,
    sqlite_session: Session,
    source: AgentSource,
) -> None:
    context = RequestContext("request", None, "actor", "tenant")
    agent = _persist_agent(sqlite_session)
    agent.source = source
    sqlite_session.commit()
    with pytest.raises(AppApiKeyNotReadyError):
        service.create_key(context, "app")
    with pytest.raises(AppApiKeyNotReadyError):
        service.create_agent_key(context, "agent")
    assert sqlite_session.scalar(select(ApiToken)) is None

    agent.active_config_snapshot_id = "snapshot"
    agent.active_config_is_published = False  # New draft edits must not revoke a published version.
    sqlite_session.add(
        AgentConfigRevision(
            tenant_id="tenant",
            agent_id=agent.id,
            current_snapshot_id="snapshot",
            revision=1,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        )
    )
    sqlite_session.commit()
    created = service.create_agent_key(context, "agent")
    assert service.list_agent_keys(context, "agent") == (created,)
    assert service.list_keys(context, "app") == (created,)

    agent.active_config_snapshot_id = None
    sqlite_session.commit()
    assert service.list_agent_keys(context, "agent") == (created,)
    service.delete_agent_key(context, "agent", created.id)
    assert service.list_agent_keys(context, "agent") == ()


@pytest.mark.parametrize("invalid_revision", ["tenant", "agent", "snapshot", "unpublished"])
def test_creation_requires_a_publish_revision_for_the_owned_active_snapshot(
    service: AppApiKeyService, sqlite_session: Session, invalid_revision: str
) -> None:
    context = RequestContext("request", None, "actor", "tenant")
    agent = _persist_agent(sqlite_session)
    agent.active_config_snapshot_id = "snapshot"
    agent.active_config_is_published = True
    revision = AgentConfigRevision(
        tenant_id="tenant",
        agent_id="agent",
        current_snapshot_id="snapshot",
        revision=1,
        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
    )
    match invalid_revision:
        case "tenant":
            revision.tenant_id = "foreign"
        case "agent":
            revision.agent_id = "other-agent"
        case "snapshot":
            revision.current_snapshot_id = "old-snapshot"
        case "unpublished":
            revision.operation = AgentConfigRevisionOperation.IMPORT_PACKAGE
    sqlite_session.add(revision)
    sqlite_session.commit()

    with pytest.raises(AppApiKeyNotReadyError):
        service.create_key(context, "app")
    with pytest.raises(AppApiKeyNotReadyError):
        service.create_agent_key(context, "agent")
    assert sqlite_session.scalar(select(ApiToken)) is None


@pytest.mark.parametrize(
    "invalid_state", ["tenant", "archived", "scope", "source", "app-tenant", "missing-app", "app-mode"]
)
def test_agent_resolution_checks_entire_owner_chain(
    service: AppApiKeyService, sqlite_session: Session, invalid_state: str
) -> None:
    context = RequestContext("request", None, "actor", "tenant")
    agent = _persist_agent(sqlite_session)
    app = sqlite_session.get(App, "app")
    assert app is not None
    match invalid_state:
        case "tenant":
            agent.tenant_id = "foreign"
        case "archived":
            agent.status = AgentStatus.ARCHIVED
        case "scope":
            agent.scope = AgentScope.WORKFLOW_ONLY
        case "source":
            agent.source = AgentSource.ROSTER
        case "app-tenant":
            app.tenant_id = "foreign"
        case "missing-app":
            agent.app_id = "missing"
        case "app-mode":
            app.mode = AppMode.CHAT
    sqlite_session.commit()
    with pytest.raises(ApiKeyResourceNotFoundError, match="Agent not found"):
        service.list_agent_keys(context, "agent")
