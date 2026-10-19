from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import ServiceUnavailable, Unauthorized

from constants import COOKIE_NAME_ACCESS_TOKEN, HEADER_NAME_PASSPORT
from controllers.web import passport, wraps
from enums import DeploymentEdition, WebAppAccessMode
from libs.passport import PassportService
from models.enums import CustomizeTokenStrategy
from models.model import App, AppMode, EndUser, Site
from repositories.web_passport_repository import WebPassportRepository
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.web_authentication_adapters import PassportWebAppSessionGateway
from services.web_identity_service import WebIdentityService
from services.web_passport_gateways import DeploymentWebPassportAuthGateway, PassportTokenGateway
from services.web_passport_service import WebPassportService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.web_identity_fakes import ACCOUNT_ID, WebAccounts


class PublicAppAccess:
    def find_app_id_by_code(self, app_code: str) -> str | None:
        raise AssertionError(f"Unused: {app_code}")

    def get_access_mode(self, *, app_id: str | None, app_code: str | None) -> WebAppAccessMode:
        del app_id, app_code
        return WebAppAccessMode.PUBLIC

    def requires_permission_check(self, app_id: str) -> bool:
        del app_id
        return False

    def is_user_allowed(self, *, user_id: str, app_id: str) -> bool:
        raise AssertionError(f"Public App should not require user permission: {user_id}, {app_id}")


@pytest.fixture
def identity_flow(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> tuple[PassportService, WebAccounts]:
    apply_config_overrides(monkeypatch, SECRET_KEY="test-web-passport-signing-key-with-32-bytes")
    for code in ("app-a", "app-b"):
        app = App(tenant_id=str(uuid4()), name=code, mode=AppMode.CHAT, enable_site=True, enable_api=False)
        sqlite_session.add(app)
        sqlite_session.flush()
        sqlite_session.add(
            Site(
                app_id=app.id,
                code=code,
                title=code,
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.UUID,
            )
        )
    sqlite_session.commit()
    accounts = WebAccounts()
    identity = WebIdentityService(accounts=accounts, allow_console_login=True, allow_webapp_login=False)
    signer = PassportService()
    sessions = PassportWebAppSessionGateway(
        sessions=WebAppAccessQueryRepository(session_factory=sqlite_session_factory),
        app_access=PublicAppAccess(),
        identities=identity,
    )

    def service(enabled: bool) -> WebPassportService:
        return WebPassportService(
            passports=WebPassportRepository(
                session_factory=sqlite_session_factory, generate_session_id=lambda: str(uuid4())
            ),
            auth=DeploymentWebPassportAuthGateway(
                webapp_auth_enabled=False,
                get_app_access_mode=lambda _: pytest.fail("Public flow must not call Enterprise"),
                is_user_allowed=lambda _user, _app: pytest.fail("Public flow must not call Enterprise"),
            ),
            tokens=PassportTokenGateway(passport=signer),
            identities=identity,
            app_sessions=sessions,
            account_passports_enabled=enabled,
            now=lambda: datetime.now(UTC),
            access_token_expire_minutes=60,
        )

    services = SimpleNamespace(
        web_identity=identity,
        web_passport=service(True),
        reader_only_passport=service(False),
        app_sessions=sessions,
    )
    monkeypatch.setattr(passport, "application_services", lambda: services)
    monkeypatch.setattr(wraps, "application_services", lambda: services)
    monkeypatch.setattr(wraps.SystemFeatureService, "is_webapp_auth_enabled", lambda: False)
    return signer, accounts


def test_signed_passports_are_redacted_app_scoped_and_reuse_mapping(
    app: Flask, identity_flow: tuple[PassportService, WebAccounts]
) -> None:
    signer, accounts = identity_flow
    login = signer.issue({"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": 2_000_000_000})
    tokens: list[str] = []
    end_user_ids: list[str] = []
    for code in ("app-a", "app-b", "app-a"):
        with app.test_request_context(
            "/passport?identity=account&user_id=public-hint",
            headers={
                "X-App-Code": code,
                "Authorization": f"Bearer {login}",
            },
        ):
            result = passport.PassportResource().get()
        token = result["access_token"]
        claims = signer.verify(token)
        assert "account_id" not in claims
        assert "user_id" not in claims
        assert ACCOUNT_ID not in claims.values()
        tokens.append(token)
        with app.test_request_context("/conversations", headers={"X-App-Code": code, HEADER_NAME_PASSPORT: token}):
            _, end_user = wraps.decode_jwt_token()
        end_user_ids.append(end_user.id)
        assert end_user.account_id == ACCOUNT_ID
    assert end_user_ids[0] == end_user_ids[2]
    assert end_user_ids[0] != end_user_ids[1]
    with app.test_request_context("/conversations", headers={"X-App-Code": "app-b", HEADER_NAME_PASSPORT: tokens[0]}):
        with pytest.raises(Unauthorized, match="another web app"):
            wraps.decode_jwt_token()
    accounts.status = "banned"
    with app.test_request_context("/conversations", headers={"X-App-Code": "app-a", HEADER_NAME_PASSPORT: tokens[0]}):
        with pytest.raises(Unauthorized, match="unavailable"):
            wraps.decode_jwt_token()


def test_guest_recovery_requires_passport_not_public_session_id(
    app: Flask, identity_flow: tuple[PassportService, WebAccounts], sqlite_session: Session
) -> None:
    signer, _ = identity_flow
    with app.test_request_context("/passport", headers={"X-App-Code": "app-a"}):
        first = passport.PassportResource().get()["access_token"]
    first_id = signer.verify(first)["end_user_id"]
    user = sqlite_session.get(EndUser, first_id)
    assert user is not None
    with app.test_request_context(f"/passport?user_id={user.session_id}", headers={"X-App-Code": "app-a"}):
        second = passport.PassportResource().get()["access_token"]
    assert signer.verify(second)["end_user_id"] != first_id
    with app.test_request_context("/passport", headers={"X-App-Code": "app-a", HEADER_NAME_PASSPORT: first}):
        recovered = passport.PassportResource().get()["access_token"]
    assert signer.verify(recovered)["end_user_id"] == first_id


@pytest.mark.parametrize("edition", list(DeploymentEdition))
def test_enabled_passport_reuses_account_cookie_in_any_edition(
    app: Flask,
    identity_flow: tuple[PassportService, WebAccounts],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    edition: DeploymentEdition,
) -> None:
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=edition,
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=True,
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
    )
    signer, _ = identity_flow
    login = signer.issue({"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": 2_000_000_000})
    with app.test_request_context(
        "/passport?identity=account",
        headers={
            "X-App-Code": "app-a",
            "Cookie": f"{COOKIE_NAME_ACCESS_TOKEN}={login}",
        },
    ):
        token = passport.PassportResource().get()["access_token"]
    user = sqlite_session.get(EndUser, signer.verify(token)["end_user_id"])
    assert user is not None
    assert user.account_id == ACCOUNT_ID


@pytest.mark.parametrize("login_account", [ACCOUNT_ID, "8a3e045b-9051-4e12-8431-93786413c002", None])
@pytest.mark.parametrize("account_passport", [True, False])
def test_passport_preserves_identity_across_account_login_changes_and_issuance_rollback(
    app: Flask,
    identity_flow: tuple[PassportService, WebAccounts],
    monkeypatch: pytest.MonkeyPatch,
    login_account: str | None,
    account_passport: bool,
) -> None:
    signer, _ = identity_flow
    initial_login = signer.issue({"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": 2_000_000_000})
    with app.test_request_context(
        "/passport?identity=account" if account_passport else "/passport",
        headers={"X-App-Code": "app-a", "Authorization": f"Bearer {initial_login}"},
    ):
        original = passport.PassportResource().get()["access_token"]
    services = cast(SimpleNamespace, passport.application_services())
    compatible_reader = services.reader_only_passport
    monkeypatch.setattr(services, "web_passport", compatible_reader)
    headers = {"X-App-Code": "app-a", HEADER_NAME_PASSPORT: original}
    if login_account:
        unrelated_login = signer.issue({"sub": "Console API Passport", "user_id": login_account, "exp": 2_000_000_000})
        headers["Authorization"] = f"Bearer {unrelated_login}"
    with app.test_request_context("/passport", headers=headers):
        assert passport.PassportResource().get()["access_token"] == original
        assert services.app_sessions.verify(token=original, app_code="app-a", user_id=None)
        _, user = wraps.decode_jwt_token()
        assert user.account_id == (ACCOUNT_ID if account_passport else None)
    with app.test_request_context("/passport?identity=account", headers=headers):
        with pytest.raises(ServiceUnavailable, match="not enabled"):
            passport.PassportResource().get()


def test_explicit_exchange_does_not_mutate_existing_guest(
    app: Flask, identity_flow: tuple[PassportService, WebAccounts], sqlite_session: Session
) -> None:
    signer, _ = identity_flow
    with app.test_request_context("/passport", headers={"X-App-Code": "app-a"}):
        guest = passport.PassportResource().get()["access_token"]
    guest_id = signer.verify(guest)["end_user_id"]
    login = signer.issue({"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": 2_000_000_000})
    with app.test_request_context(
        "/passport?identity=account",
        headers={
            "X-App-Code": "app-a",
            HEADER_NAME_PASSPORT: guest,
            "Authorization": f"Bearer {login}",
        },
    ):
        account = passport.PassportResource().get()["access_token"]
    assert signer.verify(account)["end_user_id"] != guest_id
    stored = sqlite_session.get(EndUser, guest_id)
    assert stored is not None
    assert stored.account_id is None
    with app.test_request_context("/conversations", headers={"X-App-Code": "app-a", HEADER_NAME_PASSPORT: guest}):
        _, user = wraps.decode_jwt_token()
        assert user.id == guest_id
