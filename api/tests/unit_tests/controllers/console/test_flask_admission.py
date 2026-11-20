"""Cloud Console and End User admission through real sessions and workspace memberships."""

from base64 import b64encode
from collections.abc import Callable
from datetime import datetime
from unittest.mock import MagicMock

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from controllers.console import bp
from dify_app import DifyApp
from enums import DeploymentEdition
from extensions import ext_login
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from libs.passport import PassportService
from libs.token import generate_csrf_token
from machinery.context import RequestContext
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from services.billing_client import saas
from services.entities.account_login_entities import LoginMode
from tests.helpers.unit.account_domain import AccountDomain

PROFILE_PATH = "/console/api/account/profile"
END_USER_PROFILE_PATH = "/console/api/account/end_user_profile"
PASSWORD = "Example-password-2026"


@pytest.fixture
def cloud_console(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[DifyApp, AccountDomain]:
    """Bind real Cloud services to SQLite without calling the external account policy API."""
    monkeypatch.setattr(
        saas,
        "account_check_account_in_freeze",
        lambda **_: saas.CheckAccountInFreezeReply(data=False, freezeType=""),
    )
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        SECRET_KEY="console-admission-test-key-with-32-bytes",
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
        COOKIE_DOMAIN="",
        LOGIN_DISABLED=False,
        ALLOW_CREATE_WORKSPACE=True,
        ENABLE_EMAIL_PASSWORD_LOGIN=True,
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=True,
    )
    services = build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.CLOUD,
        initialization_password="",
        redis=redis_transport[0],
    )
    app = DifyApp(__name__)
    app.extensions["application_services"] = services
    app.register_blueprint(bp)
    ext_login.init_app(app)
    ext_login.bind_account_loader(app, services.accounts.identity.load_user)
    return app, account_domain


def _browser_session(app: DifyApp, account_id: str) -> FlaskClient:
    """Send the admitted Account's signed session cookie and matching CSRF header."""
    client = app.test_client()
    client.set_cookie("access_token", PassportService().issue({"user_id": account_id}))
    csrf_token = generate_csrf_token(account_id)
    client.set_cookie("csrf_token", csrf_token)
    client.environ_base["HTTP_X_CSRF_TOKEN"] = csrf_token
    return client


def _password_login(client: FlaskClient, email: str, *, mode: LoginMode = LoginMode.CONSOLE) -> TestResponse:
    """Sign in using the test account's password and keep any issued CSRF cookie in sync for subsequent reads."""
    response = client.post(
        "/console/api/login",
        json={"email": email, "password": b64encode(PASSWORD.encode()).decode(), "mode": mode},
    )
    if (csrf_cookie := client.get_cookie("csrf_token")) is not None:
        client.environ_base["HTTP_X_CSRF_TOKEN"] = csrf_cookie.value
    return response


def test_end_user_profile_requires_a_valid_session_and_csrf(cloud_console: tuple[DifyApp, AccountDomain]) -> None:
    """Neither anonymous nor CSRF-less requests may read the private account-only profile."""
    app, account_domain = cloud_console
    anonymous = app.test_client()
    assert anonymous.get(END_USER_PROFILE_PATH).status_code == 401

    account = account_domain.accounts.create_account("end-user@example.com", "End User", "en-US")
    browser = _browser_session(app, account.id)
    del browser.environ_base["HTTP_X_CSRF_TOKEN"]
    assert browser.get(END_USER_PROFILE_PATH).status_code == 401
    assert account_domain.workspaces.list_ids_for_account(account.id) == ()


def test_cloud_refresh_cannot_return_an_end_user_to_an_inadmissible_console(
    cloud_console: tuple[DifyApp, AccountDomain],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    """A valid refresh token still works for End User mode but cannot loop back to a 401 Console probe."""
    app, account_domain = cloud_console
    account = account_domain.accounts.create_account("end-user@example.com", "End User", "en-US")
    _, commands = redis_transport
    commands.side_effect = lambda command, *args, **_: (
        account.id.encode() if command == "GET" and args == ("refresh_token:known-token",) else None
    )
    browser = _browser_session(app, account.id)
    browser.set_cookie("refresh_token", "known-token")

    console_refresh = browser.post("/console/api/refresh-token")
    assert console_refresh.status_code == 401
    assert not console_refresh.headers.getlist("Set-Cookie")
    assert browser.get(END_USER_PROFILE_PATH).status_code == 200
    end_user_refresh = browser.post("/console/api/refresh-token", json={"mode": "end_user"})
    assert end_user_refresh.status_code == 200, end_user_refresh.json
    assert account_domain.workspaces.list_ids_for_account(account.id) == ()


@pytest.mark.parametrize(
    ("mode", "account_status", "profile_status"),
    [
        (LoginMode.CONSOLE, AccountStatus.UNINITIALIZED, 200),
        (LoginMode.CONSOLE, AccountStatus.PENDING, 200),
        (LoginMode.END_USER, AccountStatus.UNINITIALIZED, 401),
    ],
)
def test_password_login_prepares_workspace_only_for_console(
    cloud_console: tuple[DifyApp, AccountDomain], mode: LoginMode, account_status: AccountStatus, profile_status: int
) -> None:
    """The first profile probe after explicit Console login does not depend on other Console GETs."""
    app, account_domain = cloud_console
    account = account_domain.accounts.create_account(
        "end-user@example.com", "End User", "en-US", password=PASSWORD, status=account_status.value
    )
    browser = app.test_client()

    login = _password_login(browser, account.email, mode=mode)

    assert login.status_code == 200, login.json
    workspaces = account_domain.workspaces.list_for_account(account.id)
    expected_names = ["End User's Workspace"] if mode == LoginMode.CONSOLE else []
    assert [workspace.name for workspace in workspaces] == expected_names
    assert browser.get(PROFILE_PATH).status_code == profile_status
    assert browser.get(END_USER_PROFILE_PATH).status_code == 200


@pytest.mark.parametrize("team_status", [TenantStatus.NORMAL, TenantStatus.ARCHIVE], ids=["active", "archived"])
def test_cloud_invitee_provisions_only_if_console_login_needs_a_workspace(
    cloud_console: tuple[DifyApp, AccountDomain],
    sqlite_session_factory: sessionmaker[Session],
    team_status: TenantStatus,
) -> None:
    """A new invitee keeps the team membership; only Console login can bootstrap a replacement."""
    app, account_domain = cloud_console
    inviter = account_domain.accounts.create_account("owner@example.com", "Owner", "en-US")
    team = account_domain.provisioning.create(name="Team", owner_email=inviter.email)
    invitee = account_domain.invitations.invite(
        RequestContext("request", None, inviter.id, team.id), "invitee@example.com", "en-US"
    )
    assert account_domain.workspaces.list_ids_for_account(invitee.account_id) == (team.id,)
    account_domain.accounts.reset_password(invitee.account_id, PASSWORD, email=invitee.email)
    with sqlite_session_factory.begin() as session:
        persisted_team = session.get(Tenant, team.id)
        assert persisted_team is not None
        persisted_team.status = team_status

    browser = app.test_client()
    end_user_login = _password_login(browser, invitee.email, mode=LoginMode.END_USER)
    assert end_user_login.status_code == 200, end_user_login.json
    assert account_domain.workspaces.list_ids_for_account(invitee.account_id) == (team.id,)

    console_login = _password_login(browser, invitee.email)
    assert console_login.status_code == 200, console_login.json
    assert browser.get(PROFILE_PATH).status_code == 200
    active_workspaces = account_domain.workspaces.list_for_account(invitee.account_id)
    expected_names = [team.name] if team_status == TenantStatus.NORMAL else ["invitee's Workspace"]
    assert [workspace.name for workspace in active_workspaces] == expected_names


def test_workspace_less_session_uses_end_user_profile(cloud_console: tuple[DifyApp, AccountDomain]) -> None:
    """The Console profile probe returns 401 without revoking or upgrading the account-only session."""
    app, account_domain = cloud_console
    account = account_domain.accounts.create_account(
        "end-user@example.com", "End User", "en-US", status="uninitialized"
    )
    browser = _browser_session(app, account.id)

    console_profile = browser.get(PROFILE_PATH)
    assert console_profile.status_code == 401
    assert console_profile.get_json() == {
        "code": "unauthorized",
        "message": "An active workspace is required.",
        "status": 401,
    }
    assert not console_profile.headers.getlist("Set-Cookie")
    profile = browser.get(END_USER_PROFILE_PATH)
    assert profile.status_code == 200
    assert profile.headers["Cache-Control"] == "no-store"
    profile_data = profile.get_json()
    assert isinstance(profile_data, dict)
    assert profile_data["id"] == account.id
    assert profile_data["has_tenant"] is False
    assert account_domain.workspaces.list_ids_for_account(account.id) == ()


@pytest.mark.parametrize(
    "path",
    [
        "/console/api/apps",
        "/console/api/features",
        "/console/api/workspaces/current/summary",
        "/console/api/workspaces/current/rbac/my-permissions",
    ],
)
def test_workspace_required_reads_do_not_provision(cloud_console: tuple[DifyApp, AccountDomain], path: str) -> None:
    """Parallel Console reads must not upgrade a workspace-less session while the profile probe rejects it."""
    app, account_domain = cloud_console
    account = account_domain.accounts.create_account("end-user@example.com", "End User", "en-US")

    response = _browser_session(app, account.id).get(path)

    assert response.status_code == 403, response.json
    assert response.get_json()["code"] == "active_workspace_required"
    assert account_domain.workspaces.list_ids_for_account(account.id) == ()


@pytest.mark.parametrize(
    "workspace_status", [TenantStatus.NORMAL, None, TenantStatus.ARCHIVE], ids=["active", "removed", "archived"]
)
def test_console_login_reuses_or_replaces_workspace_without_resetting_origin(
    cloud_console: tuple[DifyApp, AccountDomain],
    sqlite_session_factory: sessionmaker[Session],
    workspace_status: TenantStatus | None,
) -> None:
    """Console login reuses active membership or restores a workspace without changing Builder history."""
    app, account_domain = cloud_console
    account = account_domain.accounts.create_account("builder@example.com", "Builder", "en-US", password=PASSWORD)
    origin = datetime(2020, 1, 1)
    with sqlite_session_factory.begin() as session:
        builder = session.get(Account, account.id)
        assert builder is not None
        builder.first_workspace_created_at = origin
        if workspace_status is not None:
            workspace = Tenant(name="Existing workspace", status=workspace_status)
            session.add(workspace)
            session.add(
                TenantAccountJoin(
                    account_id=account.id, tenant_id=workspace.id, role=TenantAccountRole.NORMAL, current=True
                )
            )
    previous_ids = set(account_domain.workspaces.list_ids_for_account(account.id))
    browser = _browser_session(app, account.id)

    login = _password_login(browser, account.email)

    assert login.status_code == 200, login.json
    assert browser.get(PROFILE_PATH).status_code == 200
    activation = account_domain.workspaces.get_activation(account.id)
    assert activation.workspace_id is not None
    assert activation.first_workspace_created_at == origin
    if workspace_status != TenantStatus.NORMAL:
        assert activation.workspace_id not in previous_ids
        previous_ids.add(activation.workspace_id)
    assert set(account_domain.workspaces.list_ids_for_account(account.id)) == previous_ids


@pytest.mark.parametrize(
    ("account_status", "creation_allowed", "error_code"),
    [
        (AccountStatus.ACTIVE, False, "not_allowed_create_workspace"),
        (AccountStatus.CLOSED, True, "not_allowed_create_workspace"),
        (AccountStatus.BANNED, True, "account_banned"),
    ],
)
def test_console_login_denial_does_not_provision_or_issue_session(
    cloud_console: tuple[DifyApp, AccountDomain],
    config_overrides: Callable[..., None],
    account_status: AccountStatus,
    creation_allowed: bool,
    error_code: str,
) -> None:
    """Account and workspace-creation policies must be respected before issuing Console cookies."""
    app, account_domain = cloud_console
    config_overrides(ALLOW_CREATE_WORKSPACE=creation_allowed)
    account = account_domain.accounts.create_account(
        "end-user@example.com", "End User", "en-US", password=PASSWORD, status=account_status.value
    )

    response = _password_login(app.test_client(), account.email)

    assert response.status_code == 400, response.json
    assert response.get_json()["code"] == error_code
    assert not response.headers.getlist("Set-Cookie")
    assert account_domain.workspaces.list_ids_for_account(account.id) == ()
