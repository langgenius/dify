"""Cloud Console bootstrap through authenticated HTTP requests and persisted memberships."""

from collections.abc import Callable
from datetime import datetime
from unittest.mock import MagicMock

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import bp
from dify_app import DifyApp
from enums import DeploymentEdition
from extensions import ext_login
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from services.billing_client import billing
from tests.helpers.billing_builders import subscription_info
from tests.helpers.unit.account_domain import AccountDomain

SUMMARY_PATH = "/console/api/workspaces/current/summary"
APPS_PATH = "/console/api/apps"
BOOTSTRAP_PATHS = (
    SUMMARY_PATH,
    APPS_PATH,
    "/console/api/features",
    "/console/api/workspaces/current/rbac/my-permissions",
)


@pytest.fixture
def console_bootstrap(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[DifyApp, AccountDomain]:
    """Bind real Cloud services to SQLite, substituting the external billing and storage edges."""
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        SECRET_KEY="workspace-bootstrap-test-key-with-32-bytes",
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
        COOKIE_DOMAIN="",
        LOGIN_DISABLED=False,
        ALLOW_CREATE_WORKSPACE=True,
    )
    default_quota = billing.QuotaFeatureInfo(usage=0, limit=10, reset_date=0)
    monkeypatch.setattr(billing, "subscription_get_subscription_info", lambda **_: subscription_info())
    monkeypatch.setattr(
        billing,
        "quota_get_quota_info",
        lambda **_: billing.QuotaGetInfoReply(trigger_event=default_quota, api_rate_limit=default_quota),
    )
    monkeypatch.setattr(
        billing,
        "quota_get_balance",
        lambda **_: billing.QuotaGetBalanceReply(available=200, quota=200, reserved=0, usage=0, exhausted_at=0),
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


@pytest.mark.parametrize("first_path", BOOTSTRAP_PATHS)
def test_first_console_bootstrap_request_activates_workspace(
    console_bootstrap: tuple[DifyApp, AccountDomain], first_path: str
) -> None:
    """An existing End User session bootstraps once, regardless of which Console read arrives first."""
    app, account_domain = console_bootstrap
    account = account_domain.accounts.create_account(
        "end-user@example.com", "End User", "en-US", status="uninitialized"
    )
    browser = _browser_session(app, account.id)

    profile = browser.get("/console/api/account/profile")
    assert profile.status_code == 200
    profile_data = profile.get_json()
    assert isinstance(profile_data, dict)
    assert profile_data["has_tenant"] is False
    assert account_domain.workspaces.list_ids_for_account(account.id) == ()

    first_response = browser.get(first_path)
    assert first_response.status_code == 200, first_response.json
    (workspace_id,) = account_domain.workspaces.list_ids_for_account(account.id)
    summary = browser.get(SUMMARY_PATH)
    assert summary.status_code == 200
    summary_data = summary.get_json()
    assert isinstance(summary_data, dict)
    assert summary_data["id"] == workspace_id
    assert summary_data["name"] == "End User's Workspace"
    assert summary_data["role"] == "owner"
    apps = browser.get(APPS_PATH)
    assert apps.status_code == 200, apps.json
    assert account_domain.workspaces.list_ids_for_account(account.id) == (workspace_id,)
    activated = account_domain.repository.get(account.id)
    assert activated is not None
    assert activated.status == AccountStatus.ACTIVE
    assert activated.first_workspace_created_at is not None
    assert activated.initialized_at == activated.first_workspace_created_at


def test_console_bootstrap_preserves_existing_member_workspace(
    console_bootstrap: tuple[DifyApp, AccountDomain], sqlite_session_factory: sessionmaker[Session]
) -> None:
    """An invitee with an active membership keeps that workspace rather than becoming a new owner."""
    app, account_domain = console_bootstrap
    with sqlite_session_factory.begin() as session:
        account = Account(name="Invitee", email="invitee@example.com")
        workspace = Tenant(name="Joined workspace")
        session.add_all([account, workspace])
        session.add(TenantAccountJoin(account_id=account.id, tenant_id=workspace.id, role=TenantAccountRole.NORMAL))

    response = _browser_session(app, account.id).get(SUMMARY_PATH)

    assert response.status_code == 200
    data = response.get_json()
    assert isinstance(data, dict)
    assert data["id"] == workspace.id
    assert data["role"] == "normal"
    assert account_domain.workspaces.list_ids_for_account(account.id) == (workspace.id,)


@pytest.mark.parametrize("has_archived_workspace", [False, True], ids=["removed", "archived"])
def test_returning_builder_bootstraps_without_resetting_origin(
    console_bootstrap: tuple[DifyApp, AccountDomain],
    sqlite_session_factory: sessionmaker[Session],
    has_archived_workspace: bool,
) -> None:
    """Direct Console entry recreates a usable workspace without rewriting Builder history."""
    app, account_domain = console_bootstrap
    origin = datetime(2020, 1, 1)
    with sqlite_session_factory.begin() as session:
        account = Account(name="Builder", email="builder@example.com", first_workspace_created_at=origin)
        session.add(account)
        if has_archived_workspace:
            workspace = Tenant(name="Old workspace", status=TenantStatus.ARCHIVE)
            session.add(workspace)
            session.add(
                TenantAccountJoin(
                    account_id=account.id, tenant_id=workspace.id, role=TenantAccountRole.OWNER, current=True
                )
            )
    previous_memberships = account_domain.workspaces.list_ids_for_account(account.id)
    browser = _browser_session(app, account.id)

    apps = browser.get(APPS_PATH)
    assert apps.status_code == 200, apps.json
    activation = account_domain.workspaces.get_activation(account.id)
    assert activation.workspace_id is not None
    assert activation.workspace_id not in previous_memberships
    assert activation.first_workspace_created_at == origin
    summary = browser.get(SUMMARY_PATH)
    assert summary.status_code == 200, summary.json
    data = summary.get_json()
    assert isinstance(data, dict)
    assert data["id"] == activation.workspace_id
    assert set(account_domain.workspaces.list_ids_for_account(account.id)) == {
        *previous_memberships,
        activation.workspace_id,
    }


@pytest.mark.parametrize(("case", "status"), [("missing_csrf", 401), ("creation_disabled", 403)])
def test_console_bootstrap_denial_does_not_provision(
    console_bootstrap: tuple[DifyApp, AccountDomain],
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    case: str,
    status: int,
) -> None:
    """Reject workspace-less access without allocating membership, including before bootstrap."""
    app, account_domain = console_bootstrap
    with sqlite_session_factory.begin() as session:
        origin = datetime(2020, 1, 1) if case == "creation_disabled" else None
        account = Account(name="End User", email="end-user@example.com", first_workspace_created_at=origin)
        session.add(account)
    browser = _browser_session(app, account.id)
    if case == "missing_csrf":
        del browser.environ_base["HTTP_X_CSRF_TOKEN"]
    if case == "creation_disabled":
        config_overrides(ALLOW_CREATE_WORKSPACE=False)

    create_app = browser.post(APPS_PATH, json={})
    apps = browser.get(APPS_PATH)
    summary = browser.get(SUMMARY_PATH)

    assert summary.status_code == status, summary.json
    assert apps.status_code == status, apps.json
    assert create_app.status_code == status, create_app.json
    if status == 403:
        assert create_app.get_json() == {
            "code": "active_workspace_required",
            "message": "An active workspace is required.",
            "status": 403,
        }
    assert account_domain.workspaces.list_ids_for_account(account.id) == ()
    persisted = account_domain.repository.get(account.id)
    assert persisted is not None
    assert persisted.first_workspace_created_at == origin
