"""Shared helpers for console controller integration tests."""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol, cast

from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from constants import HEADER_NAME_CSRF_TOKEN
from libs.datetime_utils import naive_utc_now
from libs.token import _real_cookie_name, generate_csrf_token
from models import Account, DifySetup, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.model import App, AppMode
from services.account_service import AccountService


class ConsoleAccountFactory(Protocol):
    def __call__(self, *, role: TenantAccountRole = TenantAccountRole.OWNER) -> tuple[Account, Tenant]: ...


class ConsoleAppFactory(Protocol):
    def __call__(self, mode: AppMode = AppMode.CHAT) -> App: ...


@dataclass(frozen=True)
class AuthenticatedConsoleClient:
    client: FlaskClient
    headers: dict[str, str]
    account: Account
    tenant: Tenant


@dataclass(frozen=True)
class AuthenticatedConsoleAppClient(AuthenticatedConsoleClient):
    app: App


@dataclass(frozen=True)
class AuthenticatedConsoleAgentClient(AuthenticatedConsoleAppClient):
    agent: Agent


def ensure_dify_setup(db_session: Session) -> None:
    """Create a setup marker once so setup-protected console routes can be exercised."""
    if db_session.scalar(select(DifySetup).limit(1)) is not None:
        return

    db_session.add(DifySetup(version=dify_config.project.version))
    db_session.commit()


def create_console_account_and_tenant(
    db_session: Session,
    *,
    role: TenantAccountRole = TenantAccountRole.OWNER,
) -> tuple[Account, Tenant]:
    """Create an initialized owner account with a current tenant."""
    account = Account(
        email=f"test-{uuid.uuid4()}@example.com",
        name="Test User",
        interface_language="en-US",
        status=AccountStatus.ACTIVE,
    )
    account.initialized_at = naive_utc_now()
    db_session.add(account)
    db_session.commit()

    tenant = Tenant(name="Test Tenant", status=TenantStatus.NORMAL)
    db_session.add(tenant)
    db_session.commit()

    db_session.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
    )
    db_session.commit()

    account.set_tenant_id(tenant.id)
    account.timezone = "UTC"
    db_session.commit()

    ensure_dify_setup(db_session)
    return account, tenant


def create_console_app(db_session: Session, tenant_id: str, account_id: str, mode: AppMode) -> App:
    """Create a minimal app row that can be loaded by get_app_model."""
    app = App(
        tenant_id=tenant_id,
        name="Test App",
        mode=mode,
        enable_site=True,
        enable_api=True,
        created_by=account_id,
    )
    db_session.add(app)
    db_session.commit()
    return app


def create_console_agent(db_session: Session, app: App, account_id: str) -> Agent:
    agent = Agent(
        tenant_id=app.tenant_id,
        name=f"Test Agent {uuid.uuid4()}",
        description="",
        role="",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id=app.id,
        created_by=account_id,
        updated_by=account_id,
    )
    db_session.add(agent)
    db_session.commit()
    return agent


def authenticate_console_client(test_client: FlaskClient, account: Account) -> dict[str, str]:
    """Attach console auth cookies/headers for endpoints guarded by login_required."""
    access_token = AccountService.get_account_jwt_token(account)
    csrf_token = generate_csrf_token(account.id)
    test_client.set_cookie(_real_cookie_name("csrf_token"), csrf_token, domain="localhost")
    return {
        "Authorization": f"Bearer {access_token}",
        HEADER_NAME_CSRF_TOKEN: csrf_token,
    }


def unwrap[R](func: Callable[..., R]) -> Callable[..., R]:
    """Return the undecorated callable for controller methods wrapped by Flask/RESTX."""
    while hasattr(func, "__wrapped__"):
        func = cast(Callable[..., R], func.__wrapped__)
    return func
