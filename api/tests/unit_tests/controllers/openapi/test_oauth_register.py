import builtins
from collections.abc import Callable
from dataclasses import dataclass

import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.test import TestResponse

from controllers.openapi import bp as openapi_bp
from libs.oauth_bearer import sha256_hex
from libs.rate_limit import LIMIT_DCR_PER_IP, limiter_prefix
from repositories.oauth_authorization_code_repository import RedisAuthorizationCodeRepository
from services.oauth_authorize_service import OAuthAuthorizeService
from services.oauth_client_auth import authenticate_client
from services.oauth_client_registration import OAuthClientRegistrationService
from services.oauth_clients import OAuthClientRegistry
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    DictRedis,
    FakeClientRepository,
    FakeTokenSettings,
    RateLimitHits,
    install_rate_limit_store,
)

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]

_URL = "/openapi/v1/oauth/register"
REDIRECT = "https://agent.example/cb"


@dataclass
class _Services:
    oauth_registration: OAuthClientRegistrationService


@dataclass
class _World:
    app: Flask
    clients: FakeClientRepository
    hits: RateLimitHits
    overrides: Callable[..., None]


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]) -> _World:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    clients = FakeClientRepository()
    app.extensions["application_services"] = _Services(
        oauth_registration=OAuthClientRegistrationService(clients=clients)
    )
    config_overrides(ENABLE_OAUTH_AUTHORIZATION_CODE=True, ENABLE_OAUTH_DCR=True)
    hits = install_rate_limit_store(monkeypatch)
    return _World(app=app, clients=clients, hits=hits, overrides=config_overrides)


def _register(world: _World, **fields: object) -> TestResponse:
    return world.app.test_client().post(_URL, json={"redirect_uris": [REDIRECT], **fields})


class TestRegisterRouteCases:
    @staticmethod
    def test_public_registration_returns_201_and_the_client_works(world: _World) -> None:
        response = _register(world, client_name="Agent", logo_uri="https://agent.example/logo.png", extra="ignored")

        assert response.status_code == 201
        assert response.headers["Cache-Control"] == "no-store"
        body = response.get_json()
        assert body["client_id"].startswith("dcr_")
        assert body["client_name"] == "Agent"
        assert body["redirect_uris"] == [REDIRECT]
        assert body["grant_types"] == ["authorization_code", "refresh_token"]
        assert body["response_types"] == ["code"]
        assert body["token_endpoint_auth_method"] == "none"
        assert body["logo_uri"] == "https://agent.example/logo.png"
        assert isinstance(body["client_id_issued_at"], int)
        assert "client_secret" not in body
        assert "client_secret_expires_at" not in body
        authorize = OAuthAuthorizeService(
            clients=OAuthClientRegistry([world.clients]),
            codes=RedisAuthorizationCodeRepository(DictRedis()),
            settings=FakeTokenSettings(),
        )
        assert authorize.describe_client(body["client_id"], REDIRECT).display_name == "Agent"

    @staticmethod
    def test_logo_uri_is_omitted_when_unset(world: _World) -> None:
        assert "logo_uri" not in _register(world).get_json()

    @staticmethod
    @pytest.mark.parametrize("method", ["client_secret_basic", "client_secret_post"])
    def test_confidential_registration_returns_the_secret_once(world: _World, method: str) -> None:
        response = _register(world, token_endpoint_auth_method=method)

        assert response.status_code == 201
        body = response.get_json()
        assert body["token_endpoint_auth_method"] == method
        assert body["client_secret_expires_at"] == 0
        assert world.clients.rows[body["client_id"]].client_secret_hash == sha256_hex(body["client_secret"])
        authenticated = authenticate_client(
            OAuthClientRegistry([world.clients]),
            client_id=body["client_id"],
            client_secret=body["client_secret"],
            source_ip="127.0.0.1",
        )
        assert authenticated.client_id == body["client_id"]

    @staticmethod
    def test_two_registrations_get_different_ids(world: _World) -> None:
        first = _register(world).get_json()
        second = _register(world).get_json()

        assert first["client_id"] != second["client_id"]

    @staticmethod
    @pytest.mark.parametrize(
        ("fields", "error"),
        [
            ({"redirect_uris": ["http://example.com/cb"]}, "invalid_redirect_uri"),
            ({"redirect_uris": []}, "invalid_redirect_uri"),
            ({"redirect_uris": [f"https://agent.example/{i}" for i in range(11)]}, "invalid_redirect_uri"),
            ({"grant_types": ["urn:future:grant"]}, "invalid_client_metadata"),
            ({"grant_types": ["refresh_token"]}, "invalid_client_metadata"),
            ({"response_types": ["token"]}, "invalid_client_metadata"),
            ({"token_endpoint_auth_method": "private_key_jwt"}, "invalid_client_metadata"),
            ({"client_name": 5}, "invalid_client_metadata"),
        ],
    )
    def test_bad_metadata_is_a_400_with_an_error_code(world: _World, fields: dict[str, object], error: str) -> None:
        response = _register(world, **fields)

        assert response.status_code == 400
        body = response.get_json()
        assert body["error"] == error
        assert body["error_description"]
        assert world.clients.rows == {}

    @staticmethod
    def test_missing_redirect_uris_is_invalid_redirect_uri(world: _World) -> None:
        response = world.app.test_client().post(_URL, json={"client_name": "Agent"})

        assert response.status_code == 400
        assert response.get_json()["error"] == "invalid_redirect_uri"

    @staticmethod
    def test_loopback_redirect_with_a_port_is_accepted(world: _World) -> None:
        assert _register(world, redirect_uris=["http://127.0.0.1:8123/cb"]).status_code == 201

    @staticmethod
    @pytest.mark.parametrize(
        "request_kwargs",
        [
            {"json": ["https://agent.example/cb"]},
            {"json": "text"},
            {"data": "redirect_uris=https://agent.example/cb"},
            {"data": "{not json", "content_type": "application/json"},
            {"data": ""},
        ],
    )
    def test_body_that_is_not_a_json_object_is_rejected(world: _World, request_kwargs: dict[str, object]) -> None:
        response = world.app.test_client().post(_URL, **request_kwargs)

        assert response.status_code == 400
        assert response.get_json()["error"] == "invalid_client_metadata"


class TestRegisterFeatureFlagCases:
    @staticmethod
    @pytest.mark.parametrize("flag", ["ENABLE_OAUTH_DCR", "ENABLE_OAUTH_AUTHORIZATION_CODE"])
    def test_route_is_404_when_a_flag_is_off(world: _World, flag: str) -> None:
        world.overrides(**{flag: False})

        assert _register(world).status_code == 404
        assert world.clients.rows == {}

    @staticmethod
    def test_client_registered_earlier_still_resolves(world: _World) -> None:
        client_id = _register(world).get_json()["client_id"]
        world.overrides(ENABLE_OAUTH_DCR=False)

        assert _register(world).status_code == 404
        assert OAuthClientRegistry([world.clients]).resolve(client_id) is not None


class TestRegisterRateLimitCases:
    @staticmethod
    def test_registration_is_rate_limited_per_ip(world: _World) -> None:
        for _ in range(LIMIT_DCR_PER_IP.limit):
            assert _register(world).status_code == 201

        assert _register(world).status_code == 429
        assert list(world.hits.hits) == [f"{limiter_prefix(LIMIT_DCR_PER_IP)}:ip:127.0.0.1"]
