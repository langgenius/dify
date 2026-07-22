from __future__ import annotations

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from models import Account, Tenant
from models.account import TenantAccountRole
from models.model import App, AppMode
from tests.test_containers_integration_tests.controllers.console.helpers import (
    AuthenticatedConsoleAgentClient,
    AuthenticatedConsoleAppClient,
    AuthenticatedConsoleClient,
    ConsoleAccountFactory,
    ConsoleAppFactory,
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_agent,
    create_console_app,
)


@pytest.fixture
def console_account_factory(container_transaction: Session) -> ConsoleAccountFactory:
    def create(*, role: TenantAccountRole = TenantAccountRole.OWNER) -> tuple[Account, Tenant]:
        return create_console_account_and_tenant(container_transaction, role=role)

    return create


@pytest.fixture
def authenticated_console_client(
    console_account_factory: ConsoleAccountFactory,
    container_client: FlaskClient,
) -> AuthenticatedConsoleClient:
    account, tenant = console_account_factory()
    return AuthenticatedConsoleClient(
        client=container_client,
        headers=authenticate_console_client(container_client, account),
        account=account,
        tenant=tenant,
    )


@pytest.fixture
def console_app_factory(
    authenticated_console_client: AuthenticatedConsoleClient,
    container_transaction: Session,
) -> ConsoleAppFactory:
    def create(mode: AppMode = AppMode.CHAT) -> App:
        return create_console_app(
            container_transaction,
            authenticated_console_client.tenant.id,
            authenticated_console_client.account.id,
            mode,
        )

    return create


@pytest.fixture
def authenticated_console_app_client(
    authenticated_console_client: AuthenticatedConsoleClient,
    console_app_factory: ConsoleAppFactory,
) -> AuthenticatedConsoleAppClient:
    app = console_app_factory()
    return AuthenticatedConsoleAppClient(
        client=authenticated_console_client.client,
        headers=authenticated_console_client.headers,
        account=authenticated_console_client.account,
        tenant=authenticated_console_client.tenant,
        app=app,
    )


@pytest.fixture
def authenticated_console_agent_client(
    authenticated_console_client: AuthenticatedConsoleClient,
    console_app_factory: ConsoleAppFactory,
    container_transaction: Session,
) -> AuthenticatedConsoleAgentClient:
    app = console_app_factory(AppMode.AGENT)
    agent = create_console_agent(container_transaction, app, authenticated_console_client.account.id)
    return AuthenticatedConsoleAgentClient(
        client=authenticated_console_client.client,
        headers=authenticated_console_client.headers,
        account=authenticated_console_client.account,
        tenant=authenticated_console_client.tenant,
        app=app,
        agent=agent,
    )
