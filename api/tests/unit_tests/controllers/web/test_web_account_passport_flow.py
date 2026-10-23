from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Unauthorized

from constants import COOKIE_NAME_ACCESS_TOKEN, HEADER_NAME_PASSPORT
from controllers.web import passport, wraps
from enums import DeploymentEdition, WebAppAccessMode
from libs.passport import PassportService
from models.enums import CustomizeTokenStrategy
from models.model import App, AppMode, AppModelConfig, EndUser, Site
from repositories.web_passport_repository import WebPassportRepository
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.web_authentication_adapters import PassportWebAppSessionGateway
from services.web_identity_service import WebIdentityService
from services.web_passport_gateways import DeploymentWebPassportAuthGateway, PassportTokenGateway
from services.web_passport_service import WebPassportAccountExchangeDisabledError, WebPassportService
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
        config = AppModelConfig(app_id=app.id)
        config.id = str(uuid4())
        app.app_model_config_id = config.id
        sqlite_session.add(config)
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


def test_internal_account_passports_are_redacted_app_scoped_and_reuse_mapping(
    app: Flask,
    identity_flow: tuple[PassportService, WebAccounts],
) -> None:
    signer, accounts = identity_flow
    services = cast(SimpleNamespace, passport.application_services())
    login = signer.issue({"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": 2_000_000_000})
    tokens: list[str] = []
    end_user_ids: list[str] = []
    for code in ("app-a", "app-b", "app-a"):
        token = services.web_passport.issue_for_account(app_code=code, access_token=login).access_token
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


@pytest.mark.parametrize("enabled", [True, False])
@pytest.mark.parametrize("old_passport", [None, "invalid-passport"])
@pytest.mark.parametrize("edition", list(DeploymentEdition))
def test_public_passport_keeps_user_id_restoration_with_account_cookie_and_missing_or_invalid_passport(
    app: Flask,
    identity_flow: tuple[PassportService, WebAccounts],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
    old_passport: str | None,
    edition: DeploymentEdition,
) -> None:
    signer, _ = identity_flow
    services = cast(SimpleNamespace, passport.application_services())
    if not enabled:
        monkeypatch.setattr(services, "web_passport", services.reader_only_passport)
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=edition,
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=enabled,
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
    )
    with app.test_request_context("/passport?user_id=legacy-session", headers={"X-App-Code": "app-a"}):
        first = passport.PassportResource().get()["access_token"]
    first_id = signer.verify(first)["end_user_id"]
    user = sqlite_session.get(EndUser, first_id)
    assert user is not None
    user.name = "Existing visitor"
    sqlite_session.commit()
    login = signer.issue({"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": 2_000_000_000})
    headers = {"X-App-Code": "app-a", "Cookie": f"{COOKIE_NAME_ACCESS_TOKEN}={login}"}
    if old_passport:
        headers[HEADER_NAME_PASSPORT] = old_passport
    with app.test_request_context("/passport?user_id=legacy-session", headers=headers):
        recovered = passport.PassportResource().get()["access_token"]
    assert signer.verify(recovered)["end_user_id"] == first_id
    sqlite_session.refresh(user)
    assert user.account_id is None
    assert user.name == "Existing visitor"
    assert user.session_id == "legacy-session"


@pytest.mark.parametrize("login_account", [ACCOUNT_ID, "8a3e045b-9051-4e12-8431-93786413c002", None])
def test_issued_account_passport_survives_login_changes_and_issuance_rollback(
    app: Flask,
    identity_flow: tuple[PassportService, WebAccounts],
    monkeypatch: pytest.MonkeyPatch,
    login_account: str | None,
) -> None:
    signer, _ = identity_flow
    services = cast(SimpleNamespace, passport.application_services())
    initial_login = signer.issue({"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": 2_000_000_000})
    original = services.web_passport.issue_for_account(app_code="app-a", access_token=initial_login).access_token
    monkeypatch.setattr(services, "web_passport", services.reader_only_passport)
    headers = {"X-App-Code": "app-a", HEADER_NAME_PASSPORT: original}
    if login_account:
        unrelated_login = signer.issue({"sub": "Console API Passport", "user_id": login_account, "exp": 2_000_000_000})
        headers["Authorization"] = f"Bearer {unrelated_login}"
    with app.test_request_context("/conversations", headers=headers):
        assert services.app_sessions.verify(token=original, app_code="app-a", user_id=None)
        _, user = wraps.decode_jwt_token()
        assert user.account_id == ACCOUNT_ID
    with pytest.raises(WebPassportAccountExchangeDisabledError):
        services.web_passport.issue_for_account(app_code="app-a", access_token=initial_login)


def test_internal_account_issuance_does_not_bind_existing_guest(
    app: Flask,
    identity_flow: tuple[PassportService, WebAccounts],
    sqlite_session: Session,
) -> None:
    signer, _ = identity_flow
    services = cast(SimpleNamespace, passport.application_services())
    with app.test_request_context("/passport?user_id=legacy-session", headers={"X-App-Code": "app-a"}):
        guest = passport.PassportResource().get()["access_token"]
    guest_id = signer.verify(guest)["end_user_id"]
    login = signer.issue({"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": 2_000_000_000})
    account = services.web_passport.issue_for_account(app_code="app-a", access_token=login).access_token
    assert signer.verify(account)["end_user_id"] != guest_id
    stored = sqlite_session.get(EndUser, guest_id)
    assert stored is not None
    assert stored.account_id is None
    with app.test_request_context("/conversations", headers={"X-App-Code": "app-a", HEADER_NAME_PASSPORT: guest}):
        _, user = wraps.decode_jwt_token()
        assert user.id == guest_id
