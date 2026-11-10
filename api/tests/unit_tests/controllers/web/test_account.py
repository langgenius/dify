"""Exercise Account settings through real cookie verification, services and persistence."""

from collections.abc import Iterator
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from constants import COOKIE_NAME_ACCESS_TOKEN, COOKIE_NAME_WEBAPP_ACCESS_TOKEN
from controllers.web import account, account_admission, bp
from extensions.ext_application_services import ApplicationServices
from libs.passport import PassportService
from models.account import Account, AccountStatus, TenantAccountJoin
from repositories.account.repository import SQLAlchemyAccountRepository
from services.account_password_hasher import DefaultAccountPasswordHasher
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account
from tests.helpers.unit.web_identity_fakes import ACCOUNT_ID, webapp_login_claims


@pytest.fixture(autouse=True)
def account_config(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(
        monkeypatch,
        SECRET_KEY="account-settings-test-key-with-at-least-32-bytes",
        APP_WEB_URL="http://localhost",
        CONSOLE_WEB_URL="https://console.example.com",
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=True,
        ENABLE_EMAIL_PASSWORD_LOGIN=True,
    )


@pytest.fixture
def client(
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[FlaskClient]:
    with sqlite_session_factory.begin() as session:
        session.add(make_account(account_id=ACCOUNT_ID, status=AccountStatus.UNINITIALIZED))
        session.add(make_account(account_id=str(uuid4()), name="Other Account", email="other@example.com"))
    monkeypatch.setattr(account, "application_services", lambda: account_application_services)
    monkeypatch.setattr(account_admission, "application_services", lambda: account_application_services)
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    app.register_blueprint(bp)
    with app.test_client() as client:
        client.set_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN, PassportService().issue(webapp_login_claims()))
        client.environ_base["HTTP_ORIGIN"] = "http://localhost"
        yield client


def test_profile_returns_personal_settings_without_workspace_or_secrets(client: FlaskClient) -> None:
    client.environ_base.pop("HTTP_ORIGIN")
    response = client.get("/api/account/profile")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json() == {
        "name": "Test User",
        "email": "test@example.com",
        "avatar": None,
        "avatar_url": None,
        "is_password_set": False,
        "interface_language": None,
        "interface_theme": None,
        "timezone": None,
        "has_owned_tenant": False,
        "has_tenant": False,
    }
    schema = account.WebAccountProfileResponse.model_json_schema(mode="serialization")
    assert "account_login_url" not in schema["properties"]


def test_patch_updates_only_personal_settings(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    changes = {
        "name": "Updated Name",
        "avatar": "https://example.com/avatar.png",
        "interface_language": "en-US",
        "interface_theme": "dark",
        "timezone": "Asia/Shanghai",
    }
    response = client.patch("/api/account/profile", json=changes)

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json() == {
        **changes,
        "avatar_url": changes["avatar"],
        "email": "test@example.com",
        "is_password_set": False,
    }
    assert client.get("/api/account/profile").get_json()["name"] == "Updated Name"
    assert client.patch("/api/account/profile", json={}).get_json() == response.get_json()
    with sqlite_session_factory() as session:
        assert session.scalar(select(Account.name).where(Account.id != ACCOUNT_ID)) == "Other Account"
        assert session.scalar(select(func.count()).select_from(TenantAccountJoin)) == 0
        assert session.get_one(Account, ACCOUNT_ID).status == AccountStatus.UNINITIALIZED


@pytest.mark.parametrize(
    "changes",
    [
        {"name": "ab"},
        {"name": "x" * 31},
        {"name": None},
        {"avatar": None},
        {"interface_language": "invalid"},
        {"interface_theme": "system"},
        {"timezone": "invalid"},
        {"email": "other@example.com"},
        {"account_id": str(uuid4())},
        {"is_password_set": True},
    ],
)
def test_invalid_profile_changes_leave_account_unchanged(client: FlaskClient, changes: dict[str, object]) -> None:
    before = client.get("/api/account/profile").get_json()
    assert client.patch("/api/account/profile", json=changes).status_code == 400
    assert client.get("/api/account/profile").get_json() == before


@pytest.mark.parametrize("path", ["/api/account/profile", "/api/account/password"])
@pytest.mark.parametrize(
    "origin",
    [
        None,
        "null",
        "https://evil.example",
        "http://localhost.evil",
        "http://localhost/path",
        "https://console.example.com",
    ],
)
def test_mutations_require_the_webapp_origin(client: FlaskClient, path: str, origin: str | None) -> None:
    client.environ_base.pop("HTTP_ORIGIN")
    headers: dict[str, str] = {} if origin is None else {"Origin": origin}
    method = "PATCH" if path.endswith("profile") else "POST"
    assert client.open(path, method=method, headers=headers, json={}).status_code == 403


@pytest.mark.parametrize("method", ["GET", "PATCH", "POST"])
@pytest.mark.parametrize("token", [None, "invalid", "console", "app", "expired"])
def test_account_settings_reject_non_account_credentials(client: FlaskClient, method: str, token: str | None) -> None:
    client.delete_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN)
    signer = PassportService()
    client.set_cookie(COOKIE_NAME_ACCESS_TOKEN, signer.issue(webapp_login_claims()))
    if token == "console":
        token = signer.issue(webapp_login_claims(sub="Console API Passport", token_source=None))
    elif token == "app":
        token = signer.issue({"sub": "Web API Passport", "token_source": "webapp", "end_user_id": str(uuid4())})
    elif token == "expired":
        token = signer.issue(webapp_login_claims(exp=1))
    if token is not None:
        client.set_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN, token)
    path = "/api/account/password" if method == "POST" else "/api/account/profile"
    response = client.open(path, method=method, json={})
    assert response.status_code == 401
    assert response.get_json()["message"] == "Account login required."


@pytest.mark.parametrize("status", [AccountStatus.BANNED, AccountStatus.CLOSED])
def test_unavailable_account_cannot_read_or_change_settings(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], status: AccountStatus
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(Account, ACCOUNT_ID).status = status
    assert client.get("/api/account/profile").status_code == 401
    assert client.patch("/api/account/profile", json={"name": "Changed"}).status_code == 401
    assert client.post("/api/account/password", json={}).status_code == 401


def test_password_can_be_set_then_requires_current_password(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    payload = {"new_password": "new-password1", "repeat_new_password": "new-password1"}
    response = client.post("/api/account/password", json=payload)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json()["is_password_set"] is True
    assert "password" not in response.get_json()
    assert client.get("/api/account/profile").get_json()["is_password_set"] is True
    denied = client.post("/api/account/password", json=payload)
    assert denied.status_code == 400
    assert denied.get_json()["code"] == "current_password_incorrect"
    assert client.post("/api/account/password", json={**payload, "password": "wrong"}).status_code == 400
    payload = {"password": "new-password1", "new_password": "next-password2", "repeat_new_password": "next-password2"}
    assert client.post("/api/account/password", json=payload).status_code == 200
    credentials = SQLAlchemyAccountRepository(sqlite_session_factory).get_credentials(ACCOUNT_ID)
    assert credentials is not None
    assert credentials.password_hash is not None
    assert credentials.password_salt is not None
    assert DefaultAccountPasswordHasher().verify(
        "next-password2", password_hash=credentials.password_hash, password_salt=credentials.password_salt
    )


@pytest.mark.parametrize(
    ("changes", "error_code"),
    [
        ({"repeat_new_password": "different1"}, "repeat_password_not_match"),
        ({"new_password": "weak", "repeat_new_password": "weak"}, "invalid_account_password"),
        ({"password": None}, "invalid_param"),
        ({"account_id": str(uuid4())}, "invalid_param"),
    ],
)
def test_password_validation_preserves_credentials(
    client: FlaskClient, changes: dict[str, object], error_code: str, sqlite_session_factory: sessionmaker[Session]
) -> None:
    accounts = SQLAlchemyAccountRepository(sqlite_session_factory)
    before = accounts.get_credentials(ACCOUNT_ID)
    response = client.post(
        "/api/account/password",
        json={"new_password": "new-password1", "repeat_new_password": "new-password1", **changes},
    )
    assert response.status_code == 400
    assert response.get_json()["code"] == error_code
    assert accounts.get_credentials(ACCOUNT_ID) == before


def test_password_changes_respect_disabled_password_login(client: FlaskClient, monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, ENABLE_EMAIL_PASSWORD_LOGIN=False)
    assert (
        client.post(
            "/api/account/password", json={"new_password": "new-password1", "repeat_new_password": "new-password1"}
        ).status_code
        == 403
    )


def test_deleted_account_cannot_read_or_change_settings(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.delete(session.get_one(Account, ACCOUNT_ID))
    assert client.get("/api/account/profile").status_code == 401
    assert client.patch("/api/account/profile", json={"name": "Changed"}).status_code == 401
    assert client.post("/api/account/password", json={}).status_code == 401


@pytest.mark.parametrize("avatar", [None, "https://example.com/avatar.png", "avatar-file-id"])
def test_profile_resolves_avatar_urls(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], avatar: str | None
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(Account, ACCOUNT_ID).avatar = avatar
    response = client.get("/api/account/profile")
    assert response.status_code == 200
    profile = response.get_json()
    assert profile["avatar"] == avatar
    if avatar == "avatar-file-id":
        assert "/files/avatar-file-id/" in profile["avatar_url"]
        assert "sign=" in profile["avatar_url"]
    else:
        assert profile["avatar_url"] == avatar
