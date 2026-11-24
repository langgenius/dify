"""Cloud Console and End User admission through real sessions and workspace memberships."""

from base64 import b64encode
from collections.abc import Callable
from contextlib import nullcontext
from datetime import datetime
from unittest.mock import MagicMock

import pytest
from flask.testing import FlaskClient
from sqlalchemy import select
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
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from services.account.adapters import RedisInvitationTokenStore
from services.billing_client import billing, saas
from services.entities.account_activation_entities import InvitationToken
from services.entities.account_login_entities import LoginMode
from services.workspace import gateways
from services.workspace.contracts import CreatedWorkspace
from tests.helpers.billing_builders import subscription_info
from tests.helpers.unit.account_domain import AccountDomain
from tests.helpers.unit.redis_commands import RedisCommandEmulator

PROFILE_PATH = "/console/api/account/profile"
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
    ext_login.bind_account_only_loader(app, services.accounts.identity.load_account)
    return app, account_domain


def _browser_session(app: DifyApp, account_id: str) -> FlaskClient:
    """Send the admitted Account's signed session cookie and matching CSRF header."""
    client = app.test_client()
    client.set_cookie("access_token", PassportService().issue({"user_id": account_id}))
    csrf_token = generate_csrf_token(account_id)
    client.set_cookie("csrf_token", csrf_token)
    client.environ_base["HTTP_X_CSRF_TOKEN"] = csrf_token
    return client


def _password_login(
    client: FlaskClient, email: str, *, mode: LoginMode = LoginMode.CONSOLE, invite_token: str | None = None
) -> TestResponse:
    """Sign in using the test account's password and keep any issued CSRF cookie in sync for subsequent reads."""
    response = client.post(
        "/console/api/login",
        json={
            "email": email,
            "password": b64encode(PASSWORD.encode()).decode(),
            "mode": mode,
            "invite_token": invite_token,
        },
    )
    if (csrf_cookie := client.get_cookie("csrf_token")) is not None:
        client.environ_base["HTTP_X_CSRF_TOKEN"] = csrf_cookie.value
    return response


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
    cloud_console: tuple[DifyApp, AccountDomain],
    mode: LoginMode,
    account_status: AccountStatus,
    profile_status: int,
    sqlite_session: Session,
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
    assert sqlite_session.get_one(Account, account.id).be_end_user_at is None


@pytest.mark.parametrize(
    ("allow_create_workspace", "expected_profile_status", "expected_workspace_names"),
    [
        (True, 200, ["Invitee's Workspace"]),
        (False, 401, []),
    ],
    ids=["creation-allowed", "creation-disabled"],
)
def test_cloud_invitation_sign_in_provisions_personal_workspace_only_when_allowed(
    cloud_console: tuple[DifyApp, AccountDomain],
    config_overrides: Callable[..., None],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    allow_create_workspace: bool,
    expected_profile_status: int,
    expected_workspace_names: list[str],
) -> None:
    """Invitation sign-in best-effort provisions a personal workspace without blocking when disallowed."""
    app, account_domain = cloud_console
    config_overrides(ALLOW_CREATE_WORKSPACE=allow_create_workspace)
    inviter = account_domain.accounts.create_account("owner@example.com", "Owner", "en-US")
    team = account_domain.provisioning.create(name="Team", owner_email=inviter.email)
    invitee = account_domain.accounts.create_account(
        "invitee@example.com", "Invitee", "en-US", password=PASSWORD, status=AccountStatus.UNINITIALIZED.value
    )
    redis, commands = redis_transport
    commands.side_effect = RedisCommandEmulator()
    token = RedisInvitationTokenStore(redis=redis).create(
        InvitationToken(invitee.id, invitee.email, team.id, "normal", False)
    )

    browser = app.test_client()
    console_login = _password_login(browser, invitee.email, invite_token=token)
    assert console_login.status_code == 200, console_login.json
    assert console_login.get_json()["result"] == "success"
    assert browser.get(PROFILE_PATH).status_code == expected_profile_status
    check = browser.get(f"/console/api/activate/check?token={token}")
    assert check.status_code == 200, check.json
    assert check.headers["Cache-Control"] == "no-store"
    assert check.get_json()["data"]["is_current_account"] is True
    active_workspaces = account_domain.workspaces.list_for_account(invitee.id)
    assert [workspace.name for workspace in active_workspaces] == expected_workspace_names


@pytest.mark.parametrize(
    "scenario",
    [
        "first-workspace",
        "creation-disabled",
        "prior-creation",
        "other-membership",
        "anonymous",
        "failure",
    ],
)
def test_accepting_invitation_can_provision_first_cloud_workspace_without_another_login(
    cloud_console: tuple[DifyApp, AccountDomain],
    config_overrides: Callable[..., None],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    scenario: str,
) -> None:
    """Only a signed-in first-time Cloud invitee can provision, and the team stays current."""
    app, account_domain = cloud_console
    config_overrides(ALLOW_CREATE_WORKSPACE=scenario != "creation-disabled")
    redis, commands = redis_transport
    commands.side_effect = RedisCommandEmulator()
    monkeypatch.setattr(redis, "lock", lambda *_args, **_kwargs: nullcontext())
    monkeypatch.setattr(billing, "subscription_get_subscription_info", lambda **_: subscription_info())
    quota = billing.QuotaFeatureInfo(usage=0, limit=0, reset_date=0)
    monkeypatch.setattr(
        billing,
        "quota_get_quota_info",
        lambda **_: billing.QuotaGetInfoReply(trigger_event=quota, api_rate_limit=quota),
    )
    invitee = account_domain.accounts.create_account(
        "invitee@example.com", "Invitee", "en-US", password=PASSWORD, status=AccountStatus.UNINITIALIZED.value
    )
    origin = datetime(2020, 1, 1) if scenario == "prior-creation" else None
    with sqlite_session_factory.begin() as session:
        account = session.get(Account, invitee.id)
        assert account is not None
        account.first_workspace_created_at = origin
        if scenario == "other-membership":
            account.status = AccountStatus.ACTIVE
        team = Tenant(name="Inviting team")
        session.add(team)
        team_id = team.id
        if scenario == "other-membership":
            existing = Tenant(name="Existing team")
            session.add(existing)
            session.add(TenantAccountJoin(tenant_id=existing.id, account_id=invitee.id, role=TenantAccountRole.NORMAL))
    token = RedisInvitationTokenStore(redis=redis).create(
        InvitationToken(invitee.id, invitee.email, team_id, "normal", False)
    )
    browser = app.test_client()
    if scenario != "anonymous":
        assert _password_login(browser, invitee.email, mode=LoginMode.END_USER).status_code == 200
    assert browser.get(PROFILE_PATH).status_code == (200 if scenario == "other-membership" else 401)

    emitted: list[str] = []

    def observe_created(workspace: CreatedWorkspace) -> None:
        with sqlite_session_factory() as session:
            owner = session.get(Account, invitee.id)
            assert owner is not None
            assert owner.first_workspace_created_at == workspace.created_at
        emitted.append(workspace.id)

    def fail_key_write(_workspace_id: str) -> str:
        raise OSError("Key store unavailable")

    if scenario == "failure":
        monkeypatch.setattr(gateways, "generate_key_pair", fail_key_write)
    with gateways.tenant_was_created.connected_to(observe_created):
        response = browser.post("/console/api/activate", json={"token": token})
        assert response.status_code == 200, response.json
        assert browser.post("/console/api/activate", json={"token": token}).status_code == 403
    if scenario != "anonymous":
        assert browser.get(PROFILE_PATH).status_code == 200

    with sqlite_session_factory() as session:
        owner = session.get(Account, invitee.id)
        assert owner is not None
        assert owner.be_end_user_at is None
        memberships = session.scalars(select(TenantAccountJoin).where(TenantAccountJoin.account_id == invitee.id)).all()
        assert [row.tenant_id for row in memberships if row.current] == [team_id]
        assert next(row for row in memberships if row.tenant_id == team_id).role == TenantAccountRole.NORMAL
        owned = [row.tenant_id for row in memberships if row.role == TenantAccountRole.OWNER]
        assert owned == emitted
        if scenario == "first-workspace":
            assert len(owned) == 1
            personal = session.get(Tenant, owned[0])
            assert personal is not None
            assert personal.name == "Invitee's Workspace"
            assert owner.first_workspace_created_at == personal.created_at
        else:
            assert not owned
            assert owner.first_workspace_created_at == origin


def test_workspace_less_session_is_rejected_by_console_profile_without_revocation(
    cloud_console: tuple[DifyApp, AccountDomain],
) -> None:
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
        "message": "Unauthorized.",
        "status": 401,
    }
    assert not console_profile.headers.getlist("Set-Cookie")
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
    """Parallel Console reads reject a workspace-less session with 401 and do not provision."""
    app, account_domain = cloud_console
    account = account_domain.accounts.create_account("end-user@example.com", "End User", "en-US")

    response = _browser_session(app, account.id).get(path)

    assert response.status_code == 401, response.json
    assert response.get_json()["code"] == "unauthorized"
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
