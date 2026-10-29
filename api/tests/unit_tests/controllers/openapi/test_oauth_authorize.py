import builtins
from collections.abc import Callable
from dataclasses import dataclass
from typing import cast
from urllib.parse import parse_qs, urlsplit

import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.test import TestResponse

from controllers.console import flask_admission, wraps
from controllers.openapi import bp as openapi_bp
from dify_app import DifyApp
from extensions.ext_login import login_manager
from libs import login
from libs.login import AccountWithTenant
from models.account import Account, AccountStatus
from repositories.oauth_authorization_code_repository import RedisAuthorizationCodeRepository
from services.oauth_authorize_service import OAuthAuthorizeService
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    ACCOUNT_ID,
    CHALLENGE,
    ISSUER,
    WEB_ID,
    WEB_REDIRECT,
    WORKSPACE_ID,
    DictRedis,
    RateLimitHits,
    install_rate_limit_store,
    registry,
    web_client,
)

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]

_PREFIX = "/openapi/v1/oauth/authorize"
QUERY_REDIRECT = "https://app.example/cb?tenant=a%20b"


@dataclass
class _Services:
    oauth_authorize: OAuthAuthorizeService


@dataclass
class _World:
    app: Flask
    hits: RateLimitHits


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]) -> _World:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    app.extensions["application_services"] = _Services(
        oauth_authorize=OAuthAuthorizeService(
            clients=registry(web_client(redirect_uris=(WEB_REDIRECT, QUERY_REDIRECT))),
            codes=RedisAuthorizationCodeRepository(DictRedis()),
        )
    )
    account = Account(name="Ada", email="ada@example.com", status=AccountStatus.ACTIVE)
    account.id = ACCOUNT_ID

    config_overrides(
        LOGIN_DISABLED=True,
        ENABLE_OAUTH_BEARER=True,
        ENABLE_OAUTH_AUTHORIZATION_CODE=True,
        CONSOLE_API_URL="https://api.example",
    )
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: AccountWithTenant(account, WORKSPACE_ID))
    monkeypatch.setattr(
        flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, WORKSPACE_ID)
    )
    monkeypatch.setattr("libs.login.current_account_with_tenant_optional", lambda: (account, WORKSPACE_ID))
    return _World(app=app, hits=install_rate_limit_store(monkeypatch))


def _body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "client_id": WEB_ID,
        "redirect_uri": WEB_REDIRECT,
        "code_challenge": CHALLENGE,
        "code_challenge_method": "S256",
        "state": "xyz",
    }
    body.update(overrides)
    return body


def _post(world: _World, action: str, **overrides: object) -> TestResponse:
    return world.app.test_client().post(f"{_PREFIX}/{action}", json=_body(**overrides))


def _lookup(world: _World, **params: str) -> TestResponse:
    query = {"client_id": WEB_ID, "redirect_uri": WEB_REDIRECT, **params}
    return world.app.test_client().get(f"{_PREFIX}/client", query_string=query)


def _redirect_query(response: TestResponse) -> dict[str, list[str]]:
    body = response.get_json()
    assert isinstance(body, dict)
    return parse_qs(urlsplit(body["redirect_to"]).query)


class TestAuthorizeClientLookupCases:
    @staticmethod
    def test_lookup_needs_no_login(
        world: _World, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
    ) -> None:
        config_overrides(LOGIN_DISABLED=False)

        def no_login() -> None:
            pytest.fail("the client lookup must not resolve a Console account")

        monkeypatch.setattr(login, "_resolve_current_user", no_login)

        response = _lookup(world)

        assert response.status_code == 200
        assert response.get_json() == {
            "client_id": WEB_ID,
            "display_name": "QwenWork",
            "logo_uri": "https://nango-qwenwork.cn/logo.png",
            "redirect_host": "nango-qwenwork.cn",
            "localhost_only": False,
            "scopes": ["read", "write"],
        }

    @staticmethod
    def test_lookup_shows_the_requested_scopes(world: _World) -> None:
        response = _lookup(world, scope="offline_access read")

        assert response.get_json()["scopes"] == ["read"]

    @staticmethod
    def test_lookup_refuses_an_unknown_scope_as_an_invalid_request(world: _World) -> None:
        response = _lookup(world, scope="read admin")

        assert response.status_code == 400
        assert response.get_json() == {"error": "invalid_request"}


class TestAuthorizeDecisionCases:
    @staticmethod
    def test_approve_returns_a_server_built_redirect(world: _World) -> None:
        response = _post(world, "approve", redirect_uri=QUERY_REDIRECT)

        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
        assert response.get_json()["redirect_to"].startswith(QUERY_REDIRECT + "&code=")
        query = _redirect_query(response)
        assert (query["tenant"], query["state"], query["iss"]) == (["a b"], ["xyz"], [ISSUER])

    @staticmethod
    def test_unverified_redirect_is_400_without_a_redirect(world: _World) -> None:
        response = _post(world, "approve", redirect_uri="https://attacker.example/cb")

        assert response.status_code == 400
        assert response.get_json() == {"error": "invalid_redirect_uri"}

    @staticmethod
    @pytest.mark.parametrize(
        ("action", "overrides", "error"),
        [
            ("approve", {"code_challenge_method": "plain"}, "invalid_request"),
            ("approve", {"scope": "read admin"}, "invalid_scope"),
            ("deny", {}, "access_denied"),
        ],
    )
    def test_refusals_go_to_the_verified_redirect(
        world: _World, action: str, overrides: dict[str, object], error: str
    ) -> None:
        response = _post(world, action, **overrides)

        assert response.status_code == 200
        query = _redirect_query(response)
        assert (query["error"], query["state"], query["iss"]) == ([error], ["xyz"], [ISSUER])
        assert "code" not in query

    @staticmethod
    @pytest.mark.parametrize("action", ["approve", "deny"])
    def test_decisions_need_a_console_session(
        world: _World, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], action: str
    ) -> None:
        config_overrides(LOGIN_DISABLED=False)
        monkeypatch.setattr(login, "_resolve_current_user", lambda: None)
        login_manager.init_app(cast(DifyApp, world.app))

        response = _post(world, action)

        assert response.status_code == 401
        assert "redirect_to" not in (response.get_json() or {})
        assert world.hits.hits == {}


@pytest.mark.parametrize("flag", ["ENABLE_OAUTH_AUTHORIZATION_CODE", "ENABLE_OAUTH_BEARER"])
def test_authorize_routes_404_when_switched_off(
    world: _World, config_overrides: Callable[..., None], flag: str
) -> None:
    config_overrides(**{flag: False})
    client = world.app.test_client()

    for method, path in (("GET", "client"), ("POST", "approve"), ("POST", "deny")):
        assert client.open(f"{_PREFIX}/{path}", method=method, json=_body()).status_code == 404
    assert world.hits.hits == {}
