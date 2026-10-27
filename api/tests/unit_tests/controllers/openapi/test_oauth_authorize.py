import base64
import builtins
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import cast
from unittest.mock import create_autospec
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
from libs.rate_limit import (
    LIMIT_AUTHORIZE_APPROVE,
    LIMIT_AUTHORIZE_CLIENT_PUBLIC,
    LIMIT_CLIENT_AUTH_FAILURE,
    limiter_prefix,
)
from models.account import Account, AccountStatus
from repositories.oauth_authorization_code_repository import RedisAuthorizationCodeRepository
from repositories.oauth_refresh_token_repository import SQLAlchemyOAuthRefreshTokenRepository
from services.oauth_authorize_service import OAuthAuthorizeService
from services.oauth_device_contracts import PollPayload
from services.oauth_grant_revoker import GrantRevoker
from services.oauth_token_grants import build_grant_handlers
from services.oauth_token_service import OAuthTokenService
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    ACCOUNT_ID,
    CHALLENGE,
    CONFIDENTIAL_ID,
    CONFIDENTIAL_REDIRECT,
    CONFIDENTIAL_SECRET,
    ISSUER,
    PUBLIC_ID,
    PUBLIC_REDIRECT,
    VERIFIER,
    WORKSPACE_ID,
    DictRedis,
    FakeAccounts,
    FakeTokenIssuer,
    FakeTokenSettings,
    FakeWorkspaces,
    RateLimitHits,
    confidential_client,
    install_rate_limit_store,
    public_client,
    registry,
)

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]

_PREFIX = "/openapi/v1/oauth/authorize"
_TOKEN = "/openapi/v1/oauth/token"
QUERY_REDIRECT = "https://app.example/cb?tenant=a%20b"
DEVICE_CLIENT_ID = "difyctl"
IP_A = "192.0.2.10"
IP_B = "198.51.100.20"


@dataclass
class _FakeDevice:
    polls: list[str] = field(default_factory=list)

    def poll_device_grant(self, *, client_id: str, device_code: str, poll_ip: str) -> PollPayload:
        _ = (device_code, poll_ip)
        self.polls.append(client_id)
        return {
            "token": "dfoa_device",
            "expires_at": "2030-01-01T00:00:00+00:00",
            "subject_type": "account",
            "account": None,
            "workspaces": [],
            "default_workspace_id": None,
            "token_id": "device-token",
        }


@dataclass
class _Services:
    oauth_authorize: OAuthAuthorizeService
    oauth_token: OAuthTokenService


@dataclass
class _World:
    app: Flask
    hits: RateLimitHits
    tokens: FakeTokenIssuer
    device: _FakeDevice
    session: dict[str, str | None]


def _build_services(*, authorization_code_enabled: bool = True) -> tuple[_Services, FakeTokenIssuer, _FakeDevice]:
    clients = registry(
        confidential_client(redirect_uris=(CONFIDENTIAL_REDIRECT, QUERY_REDIRECT)),
        confidential_client(client_id=DEVICE_CLIENT_ID),
        confidential_client(client_id="other"),
        public_client(),
    )
    codes = RedisAuthorizationCodeRepository(DictRedis())
    settings = FakeTokenSettings(authorization_code_enabled=authorization_code_enabled)
    tokens = FakeTokenIssuer()
    device = _FakeDevice()
    handlers = build_grant_handlers(
        device=device,
        clients=clients,
        codes=codes,
        refresh=create_autospec(SQLAlchemyOAuthRefreshTokenRepository, instance=True),
        accounts=FakeAccounts(),
        workspaces=FakeWorkspaces(),
        tokens=tokens,
        revoke=create_autospec(GrantRevoker, instance=True),
        settings=settings,
    )
    services = _Services(
        oauth_authorize=OAuthAuthorizeService(clients=clients, codes=codes, settings=settings),
        oauth_token=OAuthTokenService(handlers=handlers),
    )
    return services, tokens, device


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]) -> _World:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    services, tokens, device = _build_services()
    app.extensions["application_services"] = services
    session: dict[str, str | None] = {"account_id": ACCOUNT_ID}

    def admitted() -> AccountWithTenant:
        account = Account(name="Ada", email="ada@example.com", status=AccountStatus.ACTIVE)
        account.id = session["account_id"] or "missing"
        return AccountWithTenant(account, WORKSPACE_ID)

    def optional() -> tuple[Account | None, str | None]:
        if session["account_id"] is None:
            return None, None
        return admitted().account, WORKSPACE_ID

    config_overrides(
        LOGIN_DISABLED=True,
        ENABLE_OAUTH_BEARER=True,
        ENABLE_OAUTH_AUTHORIZATION_CODE=True,
        CONSOLE_API_URL="https://api.example",
    )
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)
    monkeypatch.setattr(wraps, "current_account_with_tenant", admitted)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", admitted)
    monkeypatch.setattr("libs.login.current_account_with_tenant_optional", optional)
    hits = install_rate_limit_store(monkeypatch)
    return _World(app=app, hits=hits, tokens=tokens, device=device, session=session)


def _body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "client_id": CONFIDENTIAL_ID,
        "redirect_uri": CONFIDENTIAL_REDIRECT,
        "code_challenge": CHALLENGE,
        "code_challenge_method": "S256",
        "state": "xyz",
    }
    body.update(overrides)
    return {key: value for key, value in body.items() if value is not None}


def _post(world: _World, action: str, **overrides: object) -> TestResponse:
    return world.app.test_client().post(f"{_PREFIX}/{action}", json=_body(**overrides))


def _lookup(world: _World, **params: str) -> TestResponse:
    query = {"client_id": CONFIDENTIAL_ID, "redirect_uri": CONFIDENTIAL_REDIRECT, **params}
    return world.app.test_client().get(f"{_PREFIX}/client", query_string=query)


def _redirect_query(response: TestResponse) -> dict[str, list[str]]:
    body = response.get_json()
    assert isinstance(body, dict)
    return parse_qs(urlsplit(body["redirect_to"]).query)


def _approved_code(world: _World, **overrides: object) -> str:
    response = _post(world, "approve", **overrides)
    assert response.status_code == 200, response.get_json()
    return _redirect_query(response)["code"][0]


def _basic(client_id: str, secret: str) -> dict[str, str]:
    return {"Authorization": "Basic " + base64.b64encode(f"{client_id}:{secret}".encode()).decode()}


def _redeem(
    world: _World, code: str, *, headers: dict[str, str] | None = None, ip: str = IP_A, **fields: str
) -> TestResponse:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": VERIFIER,
        "redirect_uri": CONFIDENTIAL_REDIRECT,
        **fields,
    }
    return world.app.test_client().post(_TOKEN, data=data, headers=headers or {}, environ_overrides={"REMOTE_ADDR": ip})


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
            "client_id": CONFIDENTIAL_ID,
            "display_name": "QwenWork",
            "logo_uri": "https://nango-qwenwork.cn/logo.png",
            "redirect_host": "nango-qwenwork.cn",
            "localhost_only": False,
        }

    @staticmethod
    def test_lookup_flags_loopback_clients(world: _World) -> None:
        response = _lookup(world, client_id=PUBLIC_ID, redirect_uri="http://127.0.0.1:4000/callback")

        assert response.get_json()["localhost_only"] is True

    @staticmethod
    @pytest.mark.parametrize(
        ("params", "error"),
        [
            ({"client_id": "creators-platform-app"}, "invalid_client"),
            ({"redirect_uri": "https://attacker.example/cb"}, "invalid_redirect_uri"),
            ({"redirect_uri": ""}, "invalid_redirect_uri"),
        ],
    )
    def test_lookup_errors(world: _World, params: dict[str, str], error: str) -> None:
        response = _lookup(world, **params)

        assert response.status_code == 400
        assert response.get_json() == {"error": error}

    @staticmethod
    def test_lookup_without_redirect_uri_is_invalid_request(world: _World) -> None:
        response = world.app.test_client().get(f"{_PREFIX}/client", query_string={"client_id": CONFIDENTIAL_ID})

        assert response.status_code == 400
        assert response.get_json() == {"error": "invalid_request"}

    @staticmethod
    def test_lookup_is_rate_limited_per_ip(world: _World) -> None:
        for _ in range(LIMIT_AUTHORIZE_CLIENT_PUBLIC.limit):
            assert _lookup(world).status_code == 200

        assert _lookup(world).status_code == 429
        assert list(world.hits.hits) == [f"{limiter_prefix(LIMIT_AUTHORIZE_CLIENT_PUBLIC)}:ip:127.0.0.1"]


class TestAuthorizeDecisionCases:
    @staticmethod
    def test_approve_returns_a_server_built_redirect(world: _World) -> None:
        response = _post(world, "approve", redirect_uri=QUERY_REDIRECT)

        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
        redirect_to = response.get_json()["redirect_to"]
        assert redirect_to.startswith(QUERY_REDIRECT + "&code=")
        query = _redirect_query(response)
        assert query["tenant"] == ["a b"]
        assert query["state"] == ["xyz"]
        assert query["iss"] == [ISSUER]

    @staticmethod
    @pytest.mark.parametrize(
        ("overrides", "error"),
        [
            ({"code_challenge_method": "plain"}, "unsupported_code_challenge_method"),
            ({"code_challenge_method": ""}, "unsupported_code_challenge_method"),
            ({"code_challenge_method": "S512"}, "unsupported_code_challenge_method"),
            ({"code_challenge": None}, "invalid_request"),
            ({"code_challenge_method": None}, "invalid_request"),
            ({"code_challenge": 7}, "invalid_request"),
            ({"state": ["x"]}, "invalid_request"),
            ({"resource": "https://api.example"}, "invalid_target"),
            ({"client_id": "unknown"}, "invalid_client"),
            ({"redirect_uri": "https://attacker.example/cb"}, "invalid_redirect_uri"),
        ],
    )
    def test_approve_errors_never_carry_a_redirect(world: _World, overrides: dict[str, object], error: str) -> None:
        response = _post(world, "approve", **overrides)

        assert response.status_code == 400
        assert response.get_json() == {"error": error}

    @staticmethod
    def test_approve_with_a_non_object_body_is_invalid_request(world: _World) -> None:
        response = world.app.test_client().post(f"{_PREFIX}/approve", json=["x"])

        assert response.status_code == 400
        assert response.get_json() == {"error": "invalid_request"}

    @staticmethod
    def test_deny_returns_access_denied_with_state(world: _World) -> None:
        response = _post(world, "deny")

        assert response.status_code == 200
        query = _redirect_query(response)
        assert query["error"] == ["access_denied"]
        assert query["state"] == ["xyz"]
        assert query["iss"] == [ISSUER]
        assert "code" not in query

    @staticmethod
    @pytest.mark.parametrize(
        ("overrides", "error"),
        [
            ({"client_id": "unknown"}, "invalid_client"),
            ({"redirect_uri": "https://attacker.example/cb"}, "invalid_redirect_uri"),
        ],
    )
    def test_deny_errors_never_carry_a_redirect(world: _World, overrides: dict[str, object], error: str) -> None:
        response = _post(world, "deny", **overrides)

        assert response.status_code == 400
        assert response.get_json() == {"error": error}

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

    @staticmethod
    def test_approve_and_deny_share_their_own_per_account_bucket(world: _World) -> None:
        for _ in range(LIMIT_AUTHORIZE_APPROVE.limit):
            assert _post(world, "approve").status_code == 200

        assert _post(world, "deny").status_code == 429
        assert list(world.hits.hits) == [f"{limiter_prefix(LIMIT_AUTHORIZE_APPROVE)}:console_account:{ACCOUNT_ID}"]
        world.session["account_id"] = "account-2"
        assert _post(world, "deny").status_code == 200


class TestAuthorizationCodeToggleCases:
    @staticmethod
    @pytest.mark.parametrize(("method", "path"), [("get", "client"), ("post", "approve"), ("post", "deny")])
    def test_authorize_routes_404_when_disabled(
        world: _World, config_overrides: Callable[..., None], method: str, path: str
    ) -> None:
        config_overrides(ENABLE_OAUTH_AUTHORIZATION_CODE=False)
        client = world.app.test_client()

        response = client.open(f"{_PREFIX}/{path}", method=method.upper(), json=_body())

        assert response.status_code == 404
        assert world.hits.hits == {}

    @staticmethod
    def test_disabled_grant_is_unsupported_on_the_token_endpoint(world: _World) -> None:
        code = _approved_code(world)
        services, _tokens, _device = _build_services(authorization_code_enabled=False)
        world.app.extensions["application_services"] = services

        response = _redeem(world, code, client_id=CONFIDENTIAL_ID, client_secret=CONFIDENTIAL_SECRET)

        assert response.status_code == 400
        assert response.get_json() == {"error": "unsupported_grant_type"}


class TestAuthorizationCodeTokenCases:
    @staticmethod
    def test_nango_style_client_secret_post_without_resource(world: _World) -> None:
        code = _approved_code(world)

        response = _redeem(world, code, client_id=CONFIDENTIAL_ID, client_secret=CONFIDENTIAL_SECRET)

        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert body["access_token"] == "dfoa_token-1"
        assert body["token_type"] == "Bearer"
        assert 86_000 < body["expires_in"] <= 86_400
        assert body["refresh_token"] == "dfor_refresh-1"
        assert body["default_workspace_id"] == WORKSPACE_ID
        assert response.headers["Cache-Control"] == "no-store"

    @staticmethod
    def test_client_secret_basic(world: _World) -> None:
        code = _approved_code(world)

        response = _redeem(world, code, headers=_basic(CONFIDENTIAL_ID, CONFIDENTIAL_SECRET))

        assert response.status_code == 200, response.get_json()
        assert response.get_json()["access_token"] == "dfoa_token-1"

    @staticmethod
    def test_failed_client_auth_is_401_with_basic_challenge(world: _World) -> None:
        code = _approved_code(world)

        response = _redeem(world, code, client_id=CONFIDENTIAL_ID, client_secret="wrong")

        assert response.status_code == 401
        assert response.get_json() == {"error": "invalid_client"}
        assert response.headers["WWW-Authenticate"].startswith("Basic")

    @staticmethod
    def test_ten_failures_lock_one_client_from_one_ip_only(world: _World) -> None:
        def fail(client_id: str) -> TestResponse:
            return _redeem(world, "any", headers=_basic(client_id, "wrong"))

        for _ in range(10):
            assert fail(DEVICE_CLIENT_ID).status_code == 401

        locked = _redeem(world, "any", headers=_basic(DEVICE_CLIENT_ID, CONFIDENTIAL_SECRET))
        assert locked.status_code == 429
        assert locked.get_json() == {"error": "temporarily_unavailable"}
        assert "WWW-Authenticate" not in locked.headers

        code = _approved_code(world, client_id=DEVICE_CLIENT_ID)
        from_b = _redeem(world, code, headers=_basic(DEVICE_CLIENT_ID, CONFIDENTIAL_SECRET), ip=IP_B)
        assert from_b.status_code == 200, from_b.get_json()

        assert fail("other").status_code == 401
        device_poll = world.app.test_client().post(
            _TOKEN,
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": DEVICE_CLIENT_ID,
                "device_code": "device-1",
            },
            environ_overrides={"REMOTE_ADDR": IP_A},
        )
        assert device_poll.status_code == 200
        assert device_poll.get_json()["access_token"] == "dfoa_device"
        assert "refresh_token" not in device_poll.get_json()
        assert world.device.polls == [DEVICE_CLIENT_ID]
        failure_prefix = limiter_prefix(LIMIT_CLIENT_AUTH_FAILURE)
        assert {key for key in world.hits.hits if key.startswith(failure_prefix)} == {
            f"{failure_prefix}:client:{DEVICE_CLIENT_ID}:ip:{IP_A}",
            f"{failure_prefix}:client:other:ip:{IP_A}",
        }

    @staticmethod
    def test_unknown_client_is_401_every_time_and_never_counted(world: _World) -> None:
        for _ in range(11):
            response = _redeem(world, "any", headers=_basic("unknown-client", "guess"))
            assert response.status_code == 401
            assert response.get_json() == {"error": "invalid_client"}

        assert world.hits.hits == {}

    @staticmethod
    @pytest.mark.parametrize("credentials", ["form", "basic"])
    def test_public_client_with_an_empty_secret_is_treated_as_no_secret(world: _World, credentials: str) -> None:
        code = _approved_code(world, client_id=PUBLIC_ID, redirect_uri=PUBLIC_REDIRECT)
        if credentials == "form":
            response = _redeem(world, code, client_id=PUBLIC_ID, client_secret="", redirect_uri=PUBLIC_REDIRECT)
        else:
            response = _redeem(world, code, headers=_basic(PUBLIC_ID, ""), redirect_uri=PUBLIC_REDIRECT)

        assert response.status_code == 200, response.get_json()
        assert response.get_json()["access_token"] == "dfoa_token-1"

    @staticmethod
    @pytest.mark.parametrize("credentials", ["form", "basic"])
    def test_confidential_client_with_an_empty_secret_still_fails(world: _World, credentials: str) -> None:
        code = _approved_code(world)
        if credentials == "form":
            response = _redeem(world, code, client_id=CONFIDENTIAL_ID, client_secret="")
        else:
            response = _redeem(world, code, headers=_basic(CONFIDENTIAL_ID, ""))

        assert response.status_code == 401
        assert response.get_json() == {"error": "invalid_client"}
