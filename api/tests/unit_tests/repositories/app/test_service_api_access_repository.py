"""Real SQLite admission reads preserve historical key scope and close their sessions."""

from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from sqlalchemy import Connection, Engine, event, select, text
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from machinery.context import ServiceApiAccountRequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode
from repositories.app.service_api_access_repository import ServiceApiAppAccessRepository
from services.app.service_api_access_service import (
    ServiceApiAppAccess,
    ServiceApiAppAccessDeniedError,
    ServiceApiAppAccessService,
)


@dataclass(frozen=True)
class _Harness:
    repository: ServiceApiAppAccessRepository
    service: ServiceApiAppAccessService
    sessions: list[Session]


@pytest.fixture
def harness(sqlite_engine: Engine) -> Iterator[_Harness]:
    factory = sessionmaker(bind=sqlite_engine, close_resets_only=False)
    tenant = Tenant(name="App workspace")
    tenant.id = "tenant"
    owner = Account(name="Workspace owner", email="owner@example.com")
    owner.id = "owner"
    with factory.begin() as session:
        session.add_all(
            [
                tenant,
                owner,
                TenantAccountJoin(tenant_id="tenant", account_id="owner", role=TenantAccountRole.OWNER),
                App(id="app", tenant_id="tenant", name="App", mode=AppMode.CHAT, enable_site=False, enable_api=True),
            ]
        )
    sessions: list[Session] = []

    def track(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    repository = ServiceApiAppAccessRepository(session_factory=factory)
    event.listen(factory, "after_begin", track)
    try:
        yield _Harness(repository, ServiceApiAppAccessService(apps=repository), sessions)
    finally:
        event.remove(factory, "after_begin", track)
        for session in sessions:
            assert not session.in_transaction()
            assert not session.identity_map
            with pytest.raises(InvalidRequestError, match="permanently closed"):
                session.execute(select(1))


@pytest.mark.parametrize("tenant_id", [None, "tenant"])
def test_historical_key_derives_workspace_from_app(harness: _Harness, tenant_id: str | None) -> None:
    context = harness.service.resolve_account(app_id="app", tenant_id=tenant_id)

    assert context == ServiceApiAccountRequestContext(tenant_id="tenant", app_id="app", account_id="owner")
    assert len(harness.sessions) == 1


def test_provided_foreign_workspace_is_rejected(harness: _Harness) -> None:
    with pytest.raises(ServiceApiAppAccessDeniedError, match="The app no longer exists"):
        harness.service.resolve_account(app_id="app", tenant_id="other-tenant")

    assert len(harness.sessions) == 1


def test_orphaned_key_does_not_open_a_database_transaction(harness: _Harness) -> None:
    with pytest.raises(ServiceApiAppAccessDeniedError, match="The app no longer exists"):
        harness.service.resolve_account(app_id=None, tenant_id=None)

    assert harness.sessions == []


def test_abnormal_persisted_status_reaches_access_policy(harness: _Harness, sqlite_engine: Engine) -> None:
    with sqlite_engine.begin() as connection:
        connection.execute(text("UPDATE apps SET status = 'disabled' WHERE id = 'app'"))

    with pytest.raises(ServiceApiAppAccessDeniedError, match="The app's status is abnormal"):
        harness.service.resolve_account(app_id="app", tenant_id="tenant")

    assert len(harness.sessions) == 1


def test_repository_returns_values_after_session_closes(harness: _Harness) -> None:
    access = harness.repository.get_access(app_id="app", tenant_id="tenant")

    assert access == ServiceApiAppAccess(
        app_id="app",
        tenant_id="tenant",
        app_status="normal",
        enable_api=True,
        workspace_status="normal",
        account_id="owner",
    )
    assert len(harness.sessions) == 1
