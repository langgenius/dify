from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Unauthorized

from constants import COOKIE_NAME_ACCESS_TOKEN, HEADER_NAME_PASSPORT
from controllers.web import passport, wraps
from enums import DeploymentEdition
from libs.passport import PassportService
from models.enums import CustomizeTokenStrategy
from models.model import App, AppMode, EndUser, Site
from repositories.web_passport_repository import WebPassportRepository
from services.web_identity_service import WebIdentityService
from services.web_passport_gateways import DeploymentWebPassportAuthGateway, PassportTokenGateway
from services.web_passport_service import WebPassportService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.web_identity_fakes import ACCOUNT_ID, WebAccounts


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
    services = SimpleNamespace(
        web_identity=identity,
        web_passport=WebPassportService(
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
            now=lambda: datetime.now(UTC),
            access_token_expire_minutes=60,
        ),
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
            "/passport?user_id=public-hint",
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


def test_cloud_passport_reuses_account_cookie_without_workspace_context(
    app: Flask,
    identity_flow: tuple[PassportService, WebAccounts],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
    )
    signer, _ = identity_flow
    login = signer.issue({"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": 2_000_000_000})
    with app.test_request_context(
        "/passport",
        headers={
            "X-App-Code": "app-a",
            "Cookie": f"{COOKIE_NAME_ACCESS_TOKEN}={login}",
        },
    ):
        token = passport.PassportResource().get()["access_token"]
    user = sqlite_session.get(EndUser, signer.verify(token)["end_user_id"])
    assert user is not None
    assert user.account_id == ACCOUNT_ID
