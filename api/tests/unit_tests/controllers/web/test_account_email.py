"""Exercise Account-only email changes with real cookie admission, state machine and persistence."""

from collections.abc import Iterator
from dataclasses import replace
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from constants import COOKIE_NAME_WEBAPP_ACCESS_TOKEN
from controllers.web import account_admission, account_email, bp
from extensions.ext_application_services import ApplicationServices
from libs.passport import PassportService
from models.account import Account, AccountIntegrate, AccountStatus, TenantAccountJoin
from repositories.account.repository import SQLAlchemyAccountRepository
from services.account.adapters import SecureChangeEmailCodeGenerator
from services.account_change_email_service import AccountChangeEmailService
from services.entities.account_entities import AccountChangeEmailNewEmailVerifiedToken
from tests.helpers.unit.account_email import AccountEmailTransports
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account
from tests.unit_tests.web_identity_fakes import ACCOUNT_ID, webapp_login_claims

PATHS = [
    "/api/account/change-email",
    "/api/account/change-email/validity",
    "/api/account/change-email/reset",
    "/api/account/change-email/check-email-unique",
]


@pytest.fixture
def transports() -> AccountEmailTransports:
    return AccountEmailTransports()


@pytest.fixture(autouse=True)
def account_config(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(
        monkeypatch,
        SECRET_KEY="account-email-test-key-with-at-least-32-bytes",
        APP_WEB_URL="http://localhost",
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=True,
        ENABLE_CHANGE_EMAIL=True,
    )


@pytest.fixture
def client(
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
    transports: AccountEmailTransports,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[FlaskClient]:
    with sqlite_session_factory.begin() as session:
        session.add(make_account(account_id=ACCOUNT_ID, status=AccountStatus.UNINITIALIZED))
        session.add(make_account(account_id=str(uuid4()), email="other@example.com"))
        session.add(AccountIntegrate(account_id=ACCOUNT_ID, provider="github", open_id="external", encrypted_token=""))
    change_email = AccountChangeEmailService(
        accounts=SQLAlchemyAccountRepository(sqlite_session_factory),
        tokens=transports,
        codes=SecureChangeEmailCodeGenerator(),
        notifications=transports,
        send_limits=transports,
        security=transports,
        email_policy=transports,
    )
    services = replace(
        account_application_services, accounts=replace(account_application_services.accounts, change_email=change_email)
    )
    monkeypatch.setattr(account_email, "application_services", lambda: services)
    monkeypatch.setattr(account_admission, "application_services", lambda: services)
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    app.register_blueprint(bp)
    with app.test_client() as client:
        client.set_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN, PassportService().issue(webapp_login_claims()))
        client.environ_base["HTTP_ORIGIN"] = "http://localhost"
        yield client


def _verified_new_email(client: FlaskClient, transports: AccountEmailTransports, new_email: str) -> str:
    sent = client.post(PATHS[0], json={"email": "test@example.com", "language": "zh-Hans"})
    assert sent.status_code == 200
    assert sent.headers["Cache-Control"] == "no-store"
    token = sent.get_json()["data"]
    old_verified = client.post(
        PATHS[1], json={"email": "test@example.com", "code": transports.sent[-1][1], "token": token}
    )
    assert old_verified.status_code == 200
    assert token not in transports.tokens
    sent = client.post(
        PATHS[0], json={"email": new_email, "phase": "new_email", "token": old_verified.get_json()["token"]}
    )
    assert sent.status_code == 200
    verified = client.post(
        PATHS[1], json={"email": new_email, "code": transports.sent[-1][1], "token": sent.get_json()["data"]}
    )
    assert verified.status_code == 200
    assert verified.headers["Cache-Control"] == "no-store"
    return verified.get_json()["token"]


def test_email_change_requires_both_verifications_without_workspace(
    client: FlaskClient, transports: AccountEmailTransports, sqlite_session_factory: sessionmaker[Session]
) -> None:
    token = _verified_new_email(client, transports, "New@example.com")
    response = client.post(PATHS[2], json={"new_email": "New@example.com", "token": token})
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json()["email"] == "new@example.com"
    assert set(response.get_json()) == {
        "name",
        "email",
        "avatar",
        "avatar_url",
        "is_password_set",
        "interface_language",
        "interface_theme",
        "timezone",
    }
    assert transports.completed == ["new@example.com"]
    assert token not in transports.tokens
    with sqlite_session_factory() as session:
        account = session.get_one(Account, ACCOUNT_ID)
        assert account.email == account.normalized_email == "new@example.com"
        assert account.status == AccountStatus.UNINITIALIZED
        assert session.scalar(select(func.count()).select_from(TenantAccountJoin)) == 0
        assert session.scalar(select(func.count()).select_from(AccountIntegrate)) == 0
    assert client.post(PATHS[2], json={"new_email": "New@example.com", "token": token}).status_code == 400


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("origin", [None, "https://evil.example"])
def test_email_changes_require_same_origin(
    client: FlaskClient, transports: AccountEmailTransports, path: str, origin: str | None
) -> None:
    client.environ_base.pop("HTTP_ORIGIN")
    headers: dict[str, str] = {} if origin is None else {"Origin": origin}
    assert client.post(path, json={}, headers=headers).status_code == 403
    assert transports.sent == []
    assert transports.tokens == {}


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("credential", [None, "invalid", "console", "app", "expired"])
def test_email_changes_require_account_cookie(client: FlaskClient, path: str, credential: str | None) -> None:
    client.delete_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN)
    if credential == "console":
        credential = PassportService().issue(webapp_login_claims(sub="Console API Passport", token_source=None))
    elif credential == "app":
        credential = PassportService().issue({"sub": "Web API Passport", "token_source": "webapp"})
    elif credential == "expired":
        credential = PassportService().issue(webapp_login_claims(exp=1))
    if credential is not None:
        client.set_cookie(COOKIE_NAME_WEBAPP_ACCESS_TOKEN, credential)
    assert client.post(path, json={}).status_code == 401


@pytest.mark.parametrize("path", PATHS)
def test_disabled_email_changes_fail_before_payload_validation(
    client: FlaskClient, path: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, ENABLE_CHANGE_EMAIL=False)
    assert client.post(path, json={}).status_code == 403


def test_email_changes_cannot_skip_phases_or_use_foreign_tokens(
    client: FlaskClient, transports: AccountEmailTransports
) -> None:
    response = client.post(PATHS[0], json={"email": "other@example.com"})
    assert response.get_json()["code"] == "invalid_email"
    sent = client.post(PATHS[0], json={"email": "test@example.com"}).get_json()["data"]
    response = client.post(PATHS[0], json={"email": "new@example.com", "phase": "new_email", "token": sent})
    assert response.get_json()["code"] == "invalid_or_expired_token"
    response = client.post(PATHS[2], json={"new_email": "new@example.com", "token": sent})
    assert response.get_json()["code"] == "invalid_or_expired_token"
    token = transports.issue(
        AccountChangeEmailNewEmailVerifiedToken(
            account_id=str(uuid4()), email="new@example.com", old_email="test@example.com", code="123456"
        )
    )
    response = client.post(PATHS[2], json={"new_email": "new@example.com", "token": token})
    assert response.get_json()["code"] == "invalid_or_expired_token"
    response = client.post(PATHS[1], json={"email": "new@example.com", "code": "123456", "token": token})
    assert response.get_json()["code"] == "invalid_or_expired_token"
    assert transports.completed == []


def test_email_rate_limits_and_invalid_codes(client: FlaskClient, transports: AccountEmailTransports) -> None:
    token = client.post(PATHS[0], json={"email": "test@example.com"}).get_json()["data"]
    response = client.post(PATHS[1], json={"email": "test@example.com", "code": "wrong", "token": token})
    assert response.get_json()["code"] == "email_code_error"
    transports.failures["test@example.com"] = 5
    response = client.post(PATHS[1], json={"email": "test@example.com", "code": "wrong", "token": token})
    assert response.get_json()["code"] == "email_change_limit"
    transports.sends["test@example.com"] = 3
    response = client.post(PATHS[0], json={"email": "test@example.com"})
    assert response.get_json()["code"] == "email_change_rate_limit_exceeded"
    transports.ip_limited = True
    assert client.post(PATHS[0], json={"email": "test@example.com"}).get_json()["code"] == "email_send_ip_limit"


def test_email_uniqueness_and_freeze_policy(client: FlaskClient, transports: AccountEmailTransports) -> None:
    assert client.post(PATHS[3], json={"email": "available@example.com"}).get_json() == {"result": "success"}
    assert client.post(PATHS[3], json={"email": "other@example.com"}).get_json()["code"] == "email_already_in_use"
    token = _verified_new_email(client, transports, "other@example.com")
    response = client.post(PATHS[2], json={"new_email": "other@example.com", "token": token})
    assert response.get_json()["code"] == "email_already_in_use"
    transports.frozen["other@example.com"] = "email_domain_suspended"
    assert client.post(PATHS[3], json={"email": "other@example.com"}).get_json()["code"] == "email_domain_suspended"
    response = client.post(PATHS[2], json={"new_email": "other@example.com", "token": token})
    assert response.get_json()["code"] == "email_domain_suspended"
    transports.frozen["other@example.com"] = "frozen"
    assert client.post(PATHS[3], json={"email": "other@example.com"}).get_json()["code"] == "account_in_freeze"
    assert transports.completed == []


def test_account_avatar_routes_are_not_exposed(client: FlaskClient) -> None:
    """Keep personal avatar uploads and resolution outside the WebApp Account API."""
    assert client.get("/api/account/avatar").status_code == 404
    assert client.post("/api/account/avatar", data={}).status_code == 404
    schema = client.get("/api/openapi.json").get_json()
    assert "/account/avatar" not in schema["paths"]
    assert "WebAccountAvatarUploadResponse" not in schema["components"]["schemas"]
