"""A signed-in invitee without a workspace, through the real Console blueprint and identity loaders."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from redis.client import Pipeline
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import bp
from dify_app import DifyApp
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices, build_application_services
from extensions.ext_login import bind_account_loader, bind_account_only_loader, login_manager
from extensions.ext_redis import RedisClientWrapper
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models import Account
from models.account import AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account
from tests.helpers.unit.redis_commands import RedisCommandEmulator


@pytest.fixture
def account_id(sqlite_session_factory: sessionmaker[Session]) -> str:
    account = make_account(account_id=str(uuid4()), email="invitee@example.com", tenant=None)
    account.last_active_at = datetime(2020, 1, 1)
    with sqlite_session_factory.begin() as session:
        session.add(account)
    return account.id


@pytest.fixture
def browser(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    account_id: str,
) -> Iterator[FlaskClient]:
    monkeypatch.setattr(Pipeline, "execute", lambda *_args, **_kwargs: [])
    redis_transport[1].side_effect = RedisCommandEmulator()
    monkeypatch.setattr("controllers.console.wraps._is_setup_completed", lambda: True)
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        LOGIN_DISABLED=False,
        SECRET_KEY="test-only-browser-signing-key-32-bytes",
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
    )
    app = DifyApp(__name__)
    app.config["TESTING"] = True
    login_manager.init_app(app)
    bind_account_loader(app, account_application_services.accounts.identity.load_user)
    bind_account_only_loader(app, account_application_services.accounts.identity.load_account)
    services = build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis_transport[0],
    )
    app.extensions["application_services"] = replace(
        services,
        accounts=replace(account_application_services.accounts, activation=services.accounts.activation),
        workspaces=account_application_services.workspaces,
    )
    app.register_blueprint(bp)

    with app.test_client() as client:
        client.set_cookie("access_token", PassportService().issue({"user_id": account_id}))
        csrf = generate_csrf_token(account_id)
        client.set_cookie("csrf_token", csrf)
        client.environ_base["HTTP_X_CSRF_TOKEN"] = csrf
        yield client


def test_profile_admits_a_session_without_a_workspace_and_records_activity(
    browser: FlaskClient, sqlite_session_factory: sessionmaker[Session], account_id: str
) -> None:
    response = browser.get("/console/api/account/profile")

    assert response.status_code == 200, response.get_json()
    assert response.get_json()["email"] == "invitee@example.com"
    with sqlite_session_factory() as session:
        account = session.get(Account, account_id)
        assert account is not None
        assert account.last_active_at > datetime(2020, 1, 1)


def test_profile_keeps_the_current_workspace_for_a_member(
    browser: FlaskClient, sqlite_session_factory: sessionmaker[Session], account_id: str
) -> None:
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Workspace")
        session.add(tenant)
        session.flush()
        session.add(
            TenantAccountJoin(tenant_id=tenant.id, account_id=account_id, role=TenantAccountRole.NORMAL, current=True)
        )

    assert browser.get("/console/api/account/profile").status_code == 200
    assert browser.get("/console/api/workspaces/current/members").status_code == 200


def test_profile_refuses_a_banned_account(
    browser: FlaskClient, sqlite_session_factory: sessionmaker[Session], account_id: str
) -> None:
    with sqlite_session_factory.begin() as session:
        account = session.get(Account, account_id)
        assert account is not None
        account.status = AccountStatus.BANNED

    assert browser.get("/console/api/account/profile").status_code == 401


def test_workspace_routes_still_require_a_workspace(browser: FlaskClient) -> None:
    assert browser.get("/console/api/workspaces/current/members").status_code == 401


def test_activation_resolves_a_session_without_a_workspace(browser: FlaskClient) -> None:
    response = browser.post("/console/api/activate", json={"token": "missing"})

    assert response.status_code == 403
    assert response.get_json()["code"] == "already_activate"
