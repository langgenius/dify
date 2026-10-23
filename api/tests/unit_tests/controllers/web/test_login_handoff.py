import base64
import hashlib
from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import uuid4

import pytest
from flask import Flask
from redis import RedisError
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import bp as console_bp
from controllers.console import wraps
from controllers.console.auth import login as console_login
from controllers.web import bp as web_bp
from controllers.web import passport
from extensions.ext_redis import RedisClientWrapper
from libs.oauth import decode_account_oauth_state
from libs.passport import PassportService
from repositories.web_passport_repository import WebPassportRepository
from services.web_login_handoff import WebLoginHandoffService, WebLoginTarget
from services.web_login_handoff_adapters import RedisWebLoginGrantStore
from services.web_passport_gateways import PassportTokenGateway
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.controllers.web.test_web_account_passport_flow import identity_flow as identity_flow  # noqa: PLC0414 -- Register the shared pytest fixture in this module.
from tests.unit_tests.web_identity_fakes import ACCOUNT_ID, WebAccounts

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
    clock = [datetime.now(UTC)]
    services.web_login_handoff = WebLoginHandoffService(
        grants=RedisWebLoginGrantStore(redis=redis),
        apps=WebPassportRepository(session_factory=sqlite_session_factory, generate_session_id=lambda: str(uuid4())),
        identities=services.web_identity,
        tokens=PassportTokenGateway(passport=signer),
        enabled=True,
        app_web_url="https://apps.example.net",
        console_web_url="https://console.example.com",
        now=lambda: clock[0],
    )
    monkeypatch.setattr(console_login, "application_services", lambda: services)
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)
    app = Flask("login-handoff")
    app.register_blueprint(console_bp)
    app.register_blueprint(web_bp)
    login = signer.issue(
        {"sub": "Console API Passport", "user_id": ACCOUNT_ID, "exp": int((clock[0] + timedelta(hours=1)).timestamp())}
    )
    return SimpleNamespace(app=app, services=services, signer=signer, login=login, clock=clock, commands=commands)


def test_existing_console_session_crosses_sites_and_reuses_passport(handoff: SimpleNamespace) -> None:
    client = handoff.app.test_client()
    client.set_cookie("__Host-access_token", handoff.login, domain="console.example.com", secure=True)
    response = client.get(
        "/console/api/login",
        base_url="https://console.example.com",
        query_string={"mode": "end_user", "app_code": "app-a", "redirect_url": RETURN_URL, "code_challenge": CHALLENGE},
    )
    assert response.status_code == 200
    assert response.json["logged_in"] is True
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
    proof = response.json["webapp_access_token"]
    assert handoff.signer.verify(proof)["token_source"] == "webapp_account_login"
    response = client.get(
        "/api/passport?mode=end_user",
        base_url="https://apps.example.net",
        headers={"X-App-Code": "app-b", "Authorization": f"Bearer {proof}"},
    )
    assert response.status_code == 200
    assert handoff.signer.verify(response.json["access_token"])["app_code"] == "app-b"
    replay = client.post(
        "/api/passport", base_url="https://apps.example.net", headers={"X-App-Code": "app-a"}, json=payload
    )
    assert replay.status_code == 400
    assert replay.json["code"] == "invalid_param"


def test_no_console_session_reports_logged_out(handoff: SimpleNamespace) -> None:
    response = handoff.app.test_client().get(
        "/console/api/login",
        base_url="https://console.example.com",
        query_string={"app_code": "app-a", "redirect_url": RETURN_URL, "code_challenge": CHALLENGE},
    )
    assert response.status_code == 200
    assert response.json == {"logged_in": False, "redirect_url": None}


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
    token = handoff.services.web_passport.issue_for_account(app_code="app-a", access_token=handoff.login).access_token
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
    resume_query = {"mode": "end_user", "app_code": "app-a", "redirect_url": RETURN_URL, "code_challenge": CHALLENGE}
    resume = f"https://console.example.com/signin?{urlencode(resume_query)}"
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
    assert response.headers["Location"] == resume
    response = client.get("/console/api/login", base_url="https://console.example.com", query_string=resume_query)
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


@pytest.mark.parametrize("failed_command", ["SET", "GET", "GETDEL"])
def test_handoff_storage_failure_has_documented_retryable_error(handoff: SimpleNamespace, failed_command: str) -> None:
    service = handoff.services.web_login_handoff
    target = WebLoginTarget(app_code="app-a", redirect_url=RETURN_URL, code_challenge=CHALLENGE)
    code = parse_qs(urlsplit(service.authorize(target, handoff.login)).query)["login_code"][0]
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
        response = client.post(
            "/api/passport",
            base_url="https://apps.example.net",
            headers={"X-App-Code": "app-a"},
            json={"login_code": code, "code_verifier": VERIFIER},
        )
    assert response.status_code == 503
    assert response.json["code"] == "web_login_unavailable"


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
        assert response.headers["Location"] == (target if modes[index] == "end_user" else "/apps?oauth_new_user=false")
        assert service.callback_calls[-1].mode == modes[index]
        assert client.get_cookie(cookie, domain="console.example.com") is None
        assert client.get_cookie("__Host-access_token", domain="console.example.com").value == handoff.login
        if position == 0:
            assert client.get_cookie(attempts[order[1]][1], domain="console.example.com") is not None
