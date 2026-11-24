import base64
import hashlib
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from http.cookies import SimpleCookie
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock
from urllib.parse import parse_qs, parse_qsl, urlencode, urlsplit
from uuid import uuid4

import pytest
from flask import Flask
from redis import RedisError
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import bp as console_bp
from controllers.console import wraps
from controllers.console.auth import login as console_login
from controllers.web import account, account_admission, passport
from controllers.web import bp as web_bp
from extensions.ext_application_services import ApplicationServices
from extensions.ext_redis import RedisClientWrapper
from libs.oauth import decode_account_oauth_state
from libs.passport import PassportService
from models.account import Account, AccountStatus
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.web_passport_repository import WebPassportRepository
from services.web_identity_service import WebIdentityService
from services.web_login_handoff import WebLoginHandoffService, WebLoginTarget
from services.web_login_handoff_adapters import RedisWebLoginGrantStore
from services.web_passport_gateways import PassportTokenGateway
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account
from tests.helpers.unit.web_identity_fakes import ACCOUNT_ID, WebAccounts, webapp_login_claims
from tests.unit_tests.controllers.web.test_web_account_passport_flow import identity_flow as identity_flow  # noqa: PLC0414 -- Register the shared pytest fixture in this module.

VERIFIER = "v" * 43
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
RETURN_URL = "https://apps.example.net/chatbot/app-a?input=a%26b#message"


@pytest.fixture
def handoff(
    identity_flow: tuple[PassportService, WebAccounts],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> SimpleNamespace:
    signer, _ = identity_flow
    apply_config_overrides(
        monkeypatch,
        WEBAPP_ACCOUNT_PASSPORT_ENABLED=True,
        CONSOLE_WEB_URL="https://console.example.com",
        CONSOLE_API_URL="https://console.example.com",
        APP_WEB_URL="https://apps.example.net",
        COOKIE_DOMAIN="",
        REDIS_KEY_PREFIX="deployment-a",
    )
    redis, commands = redis_transport
    records: dict[str, str] = {}

    def execute(command: str, *args: object, **kwargs: object) -> object:
        del kwargs
        key = str(args[0])
        assert key.startswith("deployment-a:webapp:login-grant:")
        if command == "SET":
            assert "NX" in args
            assert args[args.index("EX") + 1] == 60
            if key in records:
                return None
            records[key] = str(args[1])
            return True
        if command == "GET":
            return records.get(key)
        if command == "GETDEL":
            return records.pop(key, None)
        raise AssertionError(command)

    commands.side_effect = execute
    services = cast(SimpleNamespace, passport.application_services())
    with sqlite_session_factory.begin() as session:
        session.add(make_account(account_id=ACCOUNT_ID, email="portal@example.net", status=AccountStatus.UNINITIALIZED))
    accounts = SQLAlchemyAccountRepository(sqlite_session_factory)
    clock = [datetime.now(UTC)]
    services.web_login_handoff = WebLoginHandoffService(
        grants=RedisWebLoginGrantStore(redis=redis),
        onboarding=accounts,
        apps=WebPassportRepository(session_factory=sqlite_session_factory, generate_session_id=lambda: str(uuid4())),
        identities=WebIdentityService(accounts=accounts, allow_console_login=True, allow_webapp_login=False),
        tokens=PassportTokenGateway(passport=signer),
        enabled=True,
        app_web_url="https://apps.example.net",
        console_web_url="https://console.example.com",
        now=lambda: clock[0],
    )
    monkeypatch.setattr(console_login, "application_services", lambda: services)
    monkeypatch.setattr(account, "application_services", lambda: services)
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)
    app = Flask("login-handoff")
    app.register_blueprint(console_bp)
    app.register_blueprint(web_bp)
    login = signer.issue(
        {"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": int((clock[0] + timedelta(hours=1)).timestamp())}
    )
    return SimpleNamespace(app=app, services=services, signer=signer, login=login, clock=clock, commands=commands)


@pytest.mark.parametrize("return_url", [RETURN_URL, "/chatbot/app-a?input=a%26b#message"])
def test_existing_console_session_crosses_sites_and_reuses_passport(
    handoff: SimpleNamespace, return_url: str, sqlite_session: Session
) -> None:
    client = handoff.app.test_client()
    client.set_cookie("__Host-access_token", handoff.login, domain="console.example.com", secure=True)
    response = client.get(
        "/console/api/login",
        base_url="https://console.example.com",
        query_string={"mode": "end_user", "app_code": "app-a", "redirect_url": return_url, "code_challenge": CHALLENGE},
    )
    assert response.status_code == 200
    assert response.json["logged_in"] is True
    assert sqlite_session.get_one(Account, ACCOUNT_ID).be_end_user_at == handoff.clock[0].replace(tzinfo=None)
    target = urlsplit(response.json["redirect_url"])
    assert (target.netloc, target.path) == ("apps.example.net", "/webapp-signin")
    query = parse_qs(target.query)
    assert query["redirect_url"] == [RETURN_URL]
    assert client.get_cookie("__Host-access_token", domain="apps.example.net") is None
    payload = {"login_code": query["login_code"][0], "code_verifier": VERIFIER}
    response = client.post(
        "/api/passport", base_url="https://apps.example.net", headers={"X-App-Code": "app-a"}, json=payload
    )
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    claims = handoff.signer.verify(response.json["access_token"])
    assert claims["token_source"] == "webapp_account"
    assert ACCOUNT_ID not in claims.values()
    assert set(response.json) == {"access_token"}
    cookies = SimpleCookie()
    cookies.load(response.headers["Set-Cookie"])
    cookie = cookies["__Host-webapp_access_token"]
    assert cookie["httponly"]
    assert cookie["secure"]
    assert cookie["samesite"] == "Lax"
    assert cookie["path"] == "/"
    assert not cookie["domain"]
    assert len(response.headers.getlist("Set-Cookie")) == 1
    assert client.get_cookie("__Host-access_token", domain="console.example.com").value == handoff.login
    proof = cookie.value
    assert handoff.signer.verify(proof)["token_source"] == "webapp_account_login"
    assert int(parsedate_to_datetime(cookie["expires"]).timestamp()) == handoff.signer.verify(proof)["exp"]
    response = client.get(
        "/api/passport?mode=end_user",
        base_url="https://apps.example.net",
        headers={"X-App-Code": "app-b"},
    )
    assert response.status_code == 200
    assert handoff.signer.verify(response.json["access_token"])["app_code"] == "app-b"
    replay = client.post(
        "/api/passport", base_url="https://apps.example.net", headers={"X-App-Code": "app-a"}, json=payload
    )
    assert replay.status_code == 400
    assert replay.json["code"] == "invalid_param"


@pytest.mark.parametrize("credential", ["missing", "console-cookie", "bearer", "console-token", "expired", "tampered"])
def test_account_passport_renewal_requires_webapp_cookie(handoff: SimpleNamespace, credential: str) -> None:
    client = handoff.app.test_client()
    proof = handoff.signer.issue(webapp_login_claims())
    headers = {"X-App-Code": "app-a"}
    if credential == "console-cookie":
        client.set_cookie("__Host-access_token", handoff.login, domain="apps.example.net", secure=True)
    elif credential == "bearer":
        headers["Authorization"] = f"Bearer {proof}"
    elif credential != "missing":
        cookie = {
            "console-token": handoff.login,
            "expired": handoff.signer.issue(webapp_login_claims(exp=1)),
            "tampered": "invalid-signature",
        }[credential]
        client.set_cookie("__Host-webapp_access_token", cookie, domain="apps.example.net", secure=True)
    response = client.get("/api/passport?mode=end_user", base_url="https://apps.example.net", headers=headers)
    assert response.status_code == 401


def test_webapp_login_and_logout_preserve_console_cookies_on_same_host(
    handoff: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    from controllers.web import login

    monkeypatch.setattr(login, "application_services", lambda: handoff.services)
    client = handoff.app.test_client()
    console_cookies = {"access_token": handoff.login, "refresh_token": "console-refresh", "csrf_token": "console-csrf"}
    for name, value in console_cookies.items():
        client.set_cookie(f"__Host-{name}", value, domain="apps.example.net", secure=True)
    target = handoff.services.web_login_handoff.authorize(
        WebLoginTarget(app_code="app-a", redirect_url=RETURN_URL, code_challenge=CHALLENGE), handoff.login
    )
    code = parse_qs(urlsplit(target).query)["login_code"][0]
    response = client.post(
        "/api/passport",
        base_url="https://apps.example.net",
        headers={"X-App-Code": "app-a"},
        json={"login_code": code, "code_verifier": VERIFIER},
    )
    assert response.status_code == 200
    for name, value in console_cookies.items():
        assert client.get_cookie(f"__Host-{name}", domain="apps.example.net").value == value
    assert client.get_cookie("__Host-webapp_access_token", domain="apps.example.net") is not None
    response = client.post("/api/logout", base_url="https://apps.example.net")
    assert response.status_code == 200
    assert client.get_cookie("__Host-webapp_access_token", domain="apps.example.net") is None
    for name, value in console_cookies.items():
        assert client.get_cookie(f"__Host-{name}", domain="apps.example.net").value == value


@pytest.mark.parametrize("mode", ["console", "end_user"])
@pytest.mark.parametrize("credential", ["matching-cookie", "missing", "other-account", "bearer", "console-cookie"])
def test_login_status_checks_cookie_even_without_end_user_mode(
    handoff: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    mode: str,
    credential: str,
) -> None:
    from controllers.web import login

    service = account_application_services.web_authentication
    monkeypatch.setattr(service._tokens, "_identities", handoff.services.web_identity)
    monkeypatch.setattr(service, "_app_sessions", handoff.services.app_sessions)
    monkeypatch.setattr(service, "_private_app_access_enabled", False)
    monkeypatch.setattr(login, "application_services", lambda: SimpleNamespace(web_authentication=service))
    proof = handoff.signer.issue(webapp_login_claims())
    app_passport = handoff.services.web_passport.issue_for_account(app_code="app-a", access_token=proof).access_token
    headers = {"X-App-Passport": app_passport}
    client = handoff.app.test_client()
    if credential in {"matching-cookie", "other-account"}:
        cookie = (
            proof
            if credential == "matching-cookie"
            else handoff.signer.issue(webapp_login_claims(user_id=str(uuid4())))
        )
        client.set_cookie("__Host-webapp_access_token", cookie, domain="apps.example.net", secure=True)
    elif credential == "bearer":
        headers["Authorization"] = f"Bearer {proof}"
    elif credential == "console-cookie":
        client.set_cookie("__Host-access_token", handoff.login, domain="apps.example.net", secure=True)
    response = client.get(
        "/api/login/status",
        base_url="https://apps.example.net",
        headers=headers,
        query_string={"app_code": "app-a", "mode": mode},
    )
    assert response.status_code == 200
    assert response.json["app_logged_in"] is (credential == "matching-cookie")
    if mode == "end_user":
        assert response.json["logged_in"] is (credential in {"matching-cookie", "other-account"})


def test_no_console_session_reports_logged_out(handoff: SimpleNamespace) -> None:
    response = handoff.app.test_client().get(
        "/console/api/login",
        base_url="https://console.example.com",
        query_string={"app_code": "app-a", "redirect_url": RETURN_URL, "code_challenge": CHALLENGE},
    )
    assert response.status_code == 200
    assert response.json == {"logged_in": False, "redirect_url": None}


@pytest.mark.parametrize(
    ("target", "expected"),
    [
        (None, "https://apps.example.net/my-apps"),
        ("/connections?q=a%26b#details", "https://apps.example.net/connections?q=a%26b#details"),
        ("https://apps.example.net/my-apps?sort=recent", "https://apps.example.net/my-apps?sort=recent"),
        ("https://console.example.com/my-apps?sort=recent", "https://console.example.com/my-apps?sort=recent"),
    ],
)
def test_personal_portal_login_reuses_console_session_without_app_handoff(
    handoff: SimpleNamespace, target: str | None, expected: str, sqlite_session: Session
) -> None:
    client = handoff.app.test_client()
    client.set_cookie("__Host-access_token", handoff.login, domain="console.example.com", secure=True)
    response = client.get(
        "/console/api/login",
        base_url="https://console.example.com",
        query_string={"mode": "end_user", **({"redirect_url": target} if target is not None else {})},
    )
    assert response.status_code == 200
    assert response.json == {"logged_in": True, "redirect_url": expected}
    assert sqlite_session.get_one(Account, ACCOUNT_ID).be_end_user_at == handoff.clock[0].replace(tzinfo=None)
    assert handoff.commands.call_count == 0
    cookie = client.get_cookie("__Host-webapp_access_token", domain="console.example.com")
    assert cookie is not None
    claims = handoff.signer.verify(cookie.value)
    assert claims["token_source"] == "webapp_account_login"
    assert claims["user_id"] == ACCOUNT_ID
    assert claims["exp"] == handoff.signer.verify(handoff.login)["exp"]
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("credential", ["missing", "tampered", "expired", "webapp-proof"])
def test_personal_portal_login_rejects_invalid_console_identity(
    handoff: SimpleNamespace, credential: str, sqlite_session: Session
) -> None:
    client = handoff.app.test_client()
    if credential != "missing":
        token = {
            "tampered": "invalid-token",
            "expired": handoff.signer.issue({"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": 1}),
            "webapp-proof": handoff.signer.issue(webapp_login_claims()),
        }[credential]
        client.set_cookie("__Host-access_token", token, domain="console.example.com", secure=True)
    response = client.get("/console/api/login?mode=end_user", base_url="https://console.example.com")
    assert response.status_code == 200
    assert response.json == {"logged_in": False, "redirect_url": None}
    assert client.get_cookie("__Host-webapp_access_token", domain="console.example.com") is None
    assert sqlite_session.get_one(Account, ACCOUNT_ID).be_end_user_at is None


@pytest.mark.parametrize(
    ("target", "pkce"), [(None, False), ("/connections/langgenius%2Fgoogle%2Fgmail?view=apps#details", True)]
)
def test_personal_portal_login_refreshes_without_workspace(
    handoff: SimpleNamespace, target: str | None, pkce: bool, sqlite_session: Session
) -> None:
    from unittest.mock import Mock

    from services.entities.account_entities import AccountSessionTokens
    from services.entities.account_login_entities import LoginMode

    auth = Mock()
    auth.refresh.return_value = AccountSessionTokens(handoff.login, "new-refresh", "csrf")
    handoff.services.accounts = SimpleNamespace(authentication=auth)
    client = handoff.app.test_client()
    client.set_cookie("__Host-refresh_token", "old-refresh", domain="console.example.com", secure=True)
    response = client.get(
        "/console/api/login",
        base_url="https://console.example.com",
        query_string={"mode": "end_user", **({"redirect_url": target, "code_challenge": CHALLENGE} if pkce else {})},
    )
    assert response.status_code == 200
    assert response.json["logged_in"]
    assert response.json["redirect_url"] == f"https://apps.example.net{target or '/my-apps'}"
    assert ("login_code" in response.json) is pkce
    assert (client.get_cookie("__Host-webapp_access_token", domain="console.example.com") is None) is pkce
    assert sqlite_session.get_one(Account, ACCOUNT_ID).be_end_user_at == handoff.clock[0].replace(tzinfo=None)
    auth.refresh.assert_called_once_with("old-refresh", mode=LoginMode.END_USER)
    assert client.get_cookie("__Host-access_token", domain="console.example.com").value == handoff.login
    assert client.get_cookie("__Host-refresh_token", domain="console.example.com").value == "new-refresh"


def test_personal_portal_login_falls_back_to_configured_console_base_path(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, APP_WEB_URL="", CONSOLE_WEB_URL="https://console.example.com/dify")
    assert console_login._personal_portal_target("/my-apps") == "https://console.example.com/dify/my-apps"


def test_portal_handoff_writes_only_a_host_scoped_webapp_cookie(handoff: SimpleNamespace) -> None:
    client = handoff.app.test_client()
    console_origin = "https://console.example.com"
    webapp_origin = "https://apps.example.net"
    target = f"{webapp_origin}/my-apps?sort=recent#starred"
    query = {"mode": "end_user", "redirect_url": target, "code_challenge": CHALLENGE}
    response = client.get("/console/api/login", base_url=console_origin, query_string=query)
    assert response.json == {"logged_in": False, "redirect_url": None}

    client.set_cookie("__Host-access_token", handoff.login, domain="console.example.com", secure=True)
    response = client.get("/console/api/login", base_url=console_origin, query_string=query)
    assert response.status_code == 200
    assert response.json["logged_in"] is True
    assert response.json["redirect_url"] == target
    assert response.headers["Cache-Control"] == "no-store"
    assert not response.headers.getlist("Set-Cookie")
    assert client.get_cookie("__Host-webapp_access_token", domain="apps.example.net") is None
    payload = {"login_code": response.json["login_code"], "code_verifier": VERIFIER}

    foreign_origin = client.post(
        "/api/account/session", base_url=webapp_origin, headers={"Origin": console_origin}, json=payload
    )
    assert foreign_origin.status_code == 403
    assert not foreign_origin.headers.getlist("Set-Cookie")
    incorrect_verifier = client.post(
        "/api/account/session",
        base_url=webapp_origin,
        headers={"Origin": webapp_origin},
        json={**payload, "code_verifier": "x" * 43},
    )
    assert incorrect_verifier.status_code == 400
    wrong_scope = client.post("/api/passport", base_url=webapp_origin, headers={"X-App-Code": "app-a"}, json=payload)
    assert wrong_scope.status_code == 400

    response = client.post(
        "/api/account/session", base_url=webapp_origin, headers={"Origin": webapp_origin}, json=payload
    )
    assert response.status_code == 200
    assert response.json == {"result": "success"}
    assert response.headers["Cache-Control"] == "no-store"
    cookie = client.get_cookie("__Host-webapp_access_token", domain="apps.example.net")
    assert cookie is not None
    assert cookie.http_only
    assert cookie.secure
    assert cookie.origin_only
    assert cookie.same_site == "Lax"
    assert handoff.signer.verify(cookie.value)["user_id"] == ACCOUNT_ID
    assert client.get_cookie("__Host-webapp_access_token", domain="console.example.com") is None
    assert client.get_cookie("__Host-access_token", domain="apps.example.net") is None
    assert (
        client.get("/api/passport?mode=end_user", base_url=webapp_origin, headers={"X-App-Code": "app-a"}).status_code
        == 200
    )

    replay = client.post(
        "/api/account/session", base_url=webapp_origin, headers={"Origin": webapp_origin}, json=payload
    )
    assert replay.status_code == 400
    assert not replay.headers.getlist("Set-Cookie")


@pytest.mark.parametrize(("failure", "status"), [("expired", 400), ("account-closed", 401)])
def test_unusable_portal_grant_never_sets_a_cookie(
    handoff: SimpleNamespace, sqlite_session: Session, failure: str, status: int
) -> None:
    code = handoff.services.web_login_handoff.authorize_portal(access_token=handoff.login, code_challenge=CHALLENGE)
    if failure == "expired":
        handoff.clock[0] += timedelta(seconds=60)
    else:
        sqlite_session.get_one(Account, ACCOUNT_ID).status = AccountStatus.CLOSED
        sqlite_session.commit()
    response = handoff.app.test_client().post(
        "/api/account/session",
        base_url="https://apps.example.net",
        headers={"Origin": "https://apps.example.net"},
        json={"login_code": code, "code_verifier": VERIFIER},
    )
    assert response.status_code == status
    assert not response.headers.getlist("Set-Cookie")


def test_portal_handoff_does_not_accept_an_app_code_or_foreign_target(handoff: SimpleNamespace) -> None:
    client = handoff.app.test_client()
    webapp_origin = "https://apps.example.net"
    service = handoff.services.web_login_handoff
    app_callback = service.authorize(
        WebLoginTarget(app_code="app-a", redirect_url=RETURN_URL, code_challenge=CHALLENGE), handoff.login
    )
    code = parse_qs(urlsplit(app_callback).query)["login_code"][0]
    response = client.post(
        "/api/account/session",
        base_url=webapp_origin,
        headers={"Origin": webapp_origin},
        json={"login_code": code, "code_verifier": VERIFIER},
    )
    assert response.status_code == 400
    assert not response.headers.getlist("Set-Cookie")
    assert service.redeem(app_code="app-a", code=code, code_verifier=VERIFIER)

    client.set_cookie("__Host-access_token", handoff.login, domain="console.example.com", secure=True)
    for target in ("https://other.example/my-apps", "https://console.example.com/my-apps", RETURN_URL):
        response = client.get(
            "/console/api/login",
            base_url="https://console.example.com",
            query_string={"redirect_url": target, "code_challenge": CHALLENGE},
        )
        assert response.status_code == 400
        assert not response.headers.getlist("Set-Cookie")


@pytest.mark.parametrize(
    "query",
    [
        {"app_code": "app-a"},
        {"code_challenge": CHALLENGE},
        {"mode": "console"},
    ],
)
def test_personal_portal_login_rejects_ambiguous_context(handoff: SimpleNamespace, query: dict[str, str]) -> None:
    response = handoff.app.test_client().get(
        "/console/api/login",
        base_url="https://console.example.com",
        query_string=query,
    )
    assert response.status_code == 422


@pytest.mark.parametrize("target", ["https://evil.example/connections", "/signin", "/connections/../apps"])
def test_personal_portal_login_rejects_unsafe_redirect_before_issuing_cookie(
    handoff: SimpleNamespace, target: str
) -> None:
    client = handoff.app.test_client()
    client.set_cookie("__Host-access_token", handoff.login, domain="console.example.com", secure=True)
    response = client.get(
        "/console/api/login", base_url="https://console.example.com", query_string={"redirect_url": target}
    )
    assert response.status_code == 400
    assert response.headers.getlist("Set-Cookie") == []


def test_wrong_proof_or_app_does_not_consume_grant(handoff: SimpleNamespace) -> None:
    service = handoff.services.web_login_handoff
    target = service.authorize(
        WebLoginTarget(app_code="app-a", redirect_url=RETURN_URL, code_challenge=CHALLENGE), handoff.login
    )
    code = parse_qs(urlsplit(target).query)["login_code"][0]
    for app_code, verifier in [("app-a", "x" * 43), ("app-b", VERIFIER)]:
        with pytest.raises(ValueError, match="Invalid or expired"):
            service.redeem(app_code=app_code, code=code, code_verifier=verifier)
    assert service.redeem(app_code="app-a", code=code, code_verifier=VERIFIER)


def test_expired_code_is_rejected(handoff: SimpleNamespace) -> None:
    service = handoff.services.web_login_handoff
    target = WebLoginTarget(app_code="app-a", redirect_url=RETURN_URL, code_challenge=CHALLENGE)
    code = parse_qs(urlsplit(service.authorize(target, handoff.login)).query)["login_code"][0]
    handoff.clock[0] += timedelta(seconds=61)
    with pytest.raises(ValueError, match="Invalid or expired"):
        service.redeem(app_code="app-a", code=code, code_verifier=VERIFIER)


def test_account_switch_rejects_previous_account_passport(handoff: SimpleNamespace) -> None:
    login_token = handoff.signer.issue(webapp_login_claims())
    token = handoff.services.web_passport.issue_for_account(app_code="app-a", access_token=login_token).access_token
    sessions = handoff.services.app_sessions
    assert sessions.verify(token=token, app_code="app-a", user_id=None, account_id=ACCOUNT_ID)
    assert not sessions.verify(token=token, app_code="app-a", user_id=None, account_id=str(uuid4()))


def test_silent_login_refreshes_without_workspace(handoff: SimpleNamespace) -> None:
    from unittest.mock import Mock

    from services.entities.account_entities import AccountSessionTokens
    from services.entities.account_login_entities import LoginMode

    auth = Mock()
    auth.refresh.return_value = AccountSessionTokens(handoff.login, "new-refresh", "csrf")
    handoff.services.accounts = SimpleNamespace(authentication=auth)
    client = handoff.app.test_client()
    client.set_cookie("__Host-refresh_token", "old-refresh", domain="console.example.com", secure=True)
    response = client.get(
        "/console/api/login",
        base_url="https://console.example.com",
        query_string={"app_code": "app-a", "redirect_url": RETURN_URL, "code_challenge": CHALLENGE},
    )
    assert response.status_code == 200
    assert response.json["logged_in"]
    auth.refresh.assert_called_once_with("old-refresh", mode=LoginMode.END_USER)
    assert client.get_cookie("__Host-refresh_token", domain="console.example.com").value == "new-refresh"


def test_oauth_returns_through_webapp_signin_with_pkce_handoff(
    handoff: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    from controllers.console.auth import oauth
    from services.entities.account_entities import AccountSessionTokens
    from services.entities.account_oauth_entities import OAuthSignInResult
    from tests.unit_tests.controllers.console.auth.test_oauth import FakeOAuthService

    apply_config_overrides(monkeypatch, ENABLE_SOCIAL_OAUTH_LOGIN=True)
    service = FakeOAuthService(
        callback_result=OAuthSignInResult(
            tokens=AccountSessionTokens(handoff.login, "refresh", "csrf"),
            oauth_new_user=False,
        )
    )
    handoff.services.accounts = SimpleNamespace(oauth=service)
    monkeypatch.setattr(oauth, "application_services", lambda: handoff.services)
    client = handoff.app.test_client()
    resume_query = {
        "is_end_user": "1",
        "app_code": "app-a",
        "redirect_url": "/chatbot/app-a?input=a%26b#message",
        "code_challenge": CHALLENGE,
    }
    resume = f"/signin?{urlencode(resume_query)}"
    response = client.get(
        "/console/api/oauth/login/github",
        base_url="https://console.example.com",
        query_string={
            "mode": "end_user",
            "redirect_url": resume,
        },
    )
    assert response.status_code == 302
    cookies = SimpleCookie()
    cookies.load(response.headers["Set-Cookie"])
    state = service.authorization_calls[0][1].state
    assert state is not None
    nonce = decode_account_oauth_state(state).nonce
    assert cookies[f"account_oauth_github_{nonce}"]["httponly"]
    assert cookies[f"account_oauth_github_{nonce}"]["samesite"] == "Lax"
    response = client.get(
        "/console/api/oauth/authorize/github",
        base_url="https://console.example.com",
        query_string={"code": "provider-code", "state": state},
    )
    assert response.status_code == 302
    assert response.headers["Location"] == f"https://console.example.com{resume}"
    session_query = {key: value for key, value in resume_query.items() if key != "is_end_user"}
    response = client.get(
        "/console/api/login", base_url="https://console.example.com", query_string={**session_query, "mode": "end_user"}
    )
    assert response.status_code == 200
    target = urlsplit(response.json["redirect_url"])
    assert target.netloc == "apps.example.net"
    assert target.path == "/webapp-signin"
    query = parse_qs(target.query)
    assert query["redirect_url"] == [RETURN_URL]
    response = client.post(
        "/api/passport",
        base_url="https://apps.example.net",
        headers={"X-App-Code": "app-a"},
        json={
            "login_code": query["login_code"][0],
            "code_verifier": VERIFIER,
        },
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    ("cookie_domain", "target"),
    [("", None), (".example.com", "/connections/langgenius%2Fgithub?sort=recent#details")],
)
def test_oauth_personal_portal_handoff_authenticates_profile_on_web_origin(
    handoff: SimpleNamespace,
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    cookie_domain: str,
    target: str | None,
) -> None:
    from controllers.console.auth import oauth
    from services.entities.account_entities import AccountSessionTokens
    from services.entities.account_oauth_entities import OAuthSignInResult
    from tests.unit_tests.controllers.console.auth.test_oauth import FakeOAuthService

    console_origin = "https://console.example.com"
    web_origin = "https://apps.example.net"
    apply_config_overrides(
        monkeypatch,
        ENABLE_SOCIAL_OAUTH_LOGIN=True,
        COOKIE_DOMAIN=cookie_domain,
        CONSOLE_WEB_URL=f"{console_origin}/console",
        APP_WEB_URL=f"{web_origin}/web",
    )
    service = FakeOAuthService(
        callback_result=OAuthSignInResult(
            tokens=AccountSessionTokens(handoff.login, "refresh", "csrf"), oauth_new_user=False
        )
    )
    monkeypatch.setattr(account_application_services.accounts.oauth, "start_authorization", service.start_authorization)
    monkeypatch.setattr(
        account_application_services.accounts.oauth, "complete_authorization", service.complete_authorization
    )
    monkeypatch.setattr(oauth, "application_services", lambda: account_application_services)
    handoff.services.accounts = account_application_services.accounts
    monkeypatch.setattr(account_admission, "application_services", lambda: account_application_services)
    client = handoff.app.test_client()
    response = client.get(
        "/console/api/oauth/login/github",
        base_url=console_origin,
        query_string={"mode": "end_user", "code_challenge": CHALLENGE, **({"redirect_url": target} if target else {})},
    )
    assert response.status_code == 302
    state = service.authorization_calls[0][1].state
    response = client.get(
        "/console/api/oauth/authorize/github",
        base_url=console_origin,
        query_string={"code": "provider-code", "state": state},
    )
    assert response.status_code == 302
    assert all("webapp_access_token=" not in header for header in response.headers.getlist("Set-Cookie"))
    resume = urlsplit(response.headers["Location"])
    assert (resume.netloc, resume.path) == ("console.example.com", "/console/signin")
    params = dict(parse_qsl(resume.query))
    assert params == {"is_end_user": "1", "redirect_url": target or "/my-apps", "code_challenge": CHALLENGE}
    with sqlite_session_factory() as session:
        assert session.get_one(Account, ACCOUNT_ID).be_end_user_at is None
    response = client.get(
        "/console/api/login",
        base_url=console_origin,
        query_string={
            "mode": "end_user",
            "redirect_url": params["redirect_url"],
            "code_challenge": params["code_challenge"],
        },
    )
    assert response.status_code == 200
    assert response.json["logged_in"]
    with sqlite_session_factory() as session:
        assert session.get_one(Account, ACCOUNT_ID).be_end_user_at == handoff.clock[0].replace(tzinfo=None)
    assert response.json["redirect_url"] == f"{web_origin}/web{target or '/my-apps'}"
    assert not response.headers.getlist("Set-Cookie")
    assert client.get("/api/account/profile", base_url=web_origin).status_code == 401
    response = client.post(
        "/api/account/session",
        base_url=web_origin,
        headers={"Origin": web_origin},
        json={"login_code": response.json["login_code"], "code_verifier": VERIFIER},
    )
    assert response.status_code == 200
    assert response.json == {"result": "success"}
    (cookie,) = response.headers.getlist("Set-Cookie")
    assert "Domain=" not in cookie
    profile = client.get("/api/account/profile", base_url=web_origin)
    assert profile.status_code == 200
    assert profile.json["email"] == "portal@example.net"
    assert profile.json["has_tenant"] is False
    assert client.post("/api/logout", base_url=web_origin).status_code == 200
    assert client.get("/api/account/profile", base_url=web_origin).status_code == 401


@pytest.mark.parametrize("failed_command", ["SET", "GET", "GETDEL"])
def test_handoff_storage_failure_has_documented_retryable_error(
    handoff: SimpleNamespace, failed_command: str, sqlite_session: Session
) -> None:
    service = handoff.services.web_login_handoff
    target = WebLoginTarget(app_code="app-a", redirect_url=RETURN_URL, code_challenge=CHALLENGE)
    execute = handoff.commands.side_effect

    def fail(command: str, *args: object, **kwargs: object) -> object:
        if command == failed_command:
            raise RedisError("unavailable")
        return execute(command, *args, **kwargs)

    handoff.commands.side_effect = fail
    client = handoff.app.test_client()
    if failed_command == "SET":
        client.set_cookie("__Host-access_token", handoff.login, domain="console.example.com", secure=True)
        response = client.get(
            "/console/api/login",
            base_url="https://console.example.com",
            query_string=target.model_dump(),
        )
    else:
        code = parse_qs(urlsplit(service.authorize(target, handoff.login)).query)["login_code"][0]
        response = client.post(
            "/api/passport",
            base_url="https://apps.example.net",
            headers={"X-App-Code": "app-a"},
            json={"login_code": code, "code_verifier": VERIFIER},
        )
    assert response.status_code == 503
    assert response.json["code"] == "web_login_unavailable"
    expected = None if failed_command == "SET" else handoff.clock[0].replace(tzinfo=None)
    assert sqlite_session.get_one(Account, ACCOUNT_ID).be_end_user_at == expected


@pytest.mark.parametrize("modes", [("end_user", "end_user"), ("console", "end_user"), ("end_user", "console")])
@pytest.mark.parametrize("reverse_callbacks", [False, True])
def test_concurrent_oauth_attempts_keep_separate_state_and_share_account_session(
    handoff: SimpleNamespace, monkeypatch: pytest.MonkeyPatch, modes: tuple[str, str], reverse_callbacks: bool
) -> None:
    from controllers.console.auth import oauth
    from services.entities.account_entities import AccountSessionTokens
    from services.entities.account_oauth_entities import OAuthSignInResult
    from tests.unit_tests.controllers.console.auth.test_oauth import FakeOAuthService

    apply_config_overrides(monkeypatch, ENABLE_SOCIAL_OAUTH_LOGIN=True)
    service = FakeOAuthService(
        callback_result=OAuthSignInResult(
            tokens=AccountSessionTokens(handoff.login, "refresh", "csrf"), oauth_new_user=False
        )
    )
    handoff.services.accounts = SimpleNamespace(oauth=service)
    monkeypatch.setattr(oauth, "application_services", lambda: handoff.services)
    client = handoff.app.test_client()
    attempts: list[tuple[str, str, str]] = []
    for index, mode in enumerate(modes):
        target = f"https://console.example.com/signin?mode=end_user&attempt={index}" if mode == "end_user" else "/apps"
        response = client.get(
            "/console/api/oauth/login/github",
            base_url="https://console.example.com",
            query_string={"mode": mode, "redirect_url": target},
        )
        assert response.status_code == 302
        state = service.authorization_calls[-1][1].state
        assert state is not None
        cookie = f"account_oauth_github_{decode_account_oauth_state(state).nonce}"
        attempts.append((state, cookie, target))
    assert attempts[0][1] != attempts[1][1]
    for _, cookie, _ in attempts:
        assert client.get_cookie(cookie, domain="console.example.com") is not None
    order = [1, 0] if reverse_callbacks else [0, 1]
    for position, index in enumerate(order):
        state, cookie, target = attempts[index]
        response = client.get(
            "/console/api/oauth/authorize/github",
            base_url="https://console.example.com",
            query_string={"code": f"code-{index}", "state": state},
        )
        assert response.status_code == 302
        assert response.headers["Location"] == (
            target if modes[index] == "end_user" else "https://console.example.com/apps?oauth_new_user=false"
        )
        assert service.callback_calls[-1].mode == modes[index]
        assert client.get_cookie(cookie, domain="console.example.com") is None
        assert client.get_cookie("__Host-access_token", domain="console.example.com").value == handoff.login
        if position == 0:
            assert client.get_cookie(attempts[order[1]][1], domain="console.example.com") is not None
