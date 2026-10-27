import builtins
from collections.abc import Callable
from dataclasses import dataclass

import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.test import TestResponse

from controllers.openapi import bp as openapi_bp
from libs.rate_limit import LIMIT_DCR_PER_IP, limiter_prefix
from services.oauth_client_registration import OAuthClientRegistrationService
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    FakeClientRepository,
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
    def test_public_registration_returns_201_and_the_client_metadata(world: _World) -> None:
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
        assert body["client_id"] in world.clients.rows

    @staticmethod
    def test_confidential_registration_returns_the_secret_once(world: _World) -> None:
        response = _register(world, token_endpoint_auth_method="client_secret_basic")

        assert response.status_code == 201
        body = response.get_json()
        assert body["token_endpoint_auth_method"] == "client_secret_basic"
        assert body["client_secret"]
        assert body["client_secret_expires_at"] == 0

    @staticmethod
    @pytest.mark.parametrize(
        ("body", "error"),
        [
            ({"redirect_uris": ["http://example.com/cb"]}, "invalid_redirect_uri"),
            ({"redirect_uris": [REDIRECT], "grant_types": ["urn:future:grant"]}, "invalid_client_metadata"),
            ([REDIRECT], "invalid_client_metadata"),
        ],
    )
    def test_bad_metadata_is_a_400_with_an_error_code(world: _World, body: object, error: str) -> None:
        response = world.app.test_client().post(_URL, json=body)

        assert response.status_code == 400
        assert response.get_json()["error"] == error
        assert response.get_json()["error_description"]
        assert world.clients.rows == {}


class TestRegisterFeatureFlagCases:
    @staticmethod
    @pytest.mark.parametrize("flag", ["ENABLE_OAUTH_DCR", "ENABLE_OAUTH_AUTHORIZATION_CODE", "ENABLE_OAUTH_BEARER"])
    def test_route_is_404_when_a_flag_is_off(world: _World, flag: str) -> None:
        world.overrides(**{flag: False})

        assert _register(world).status_code == 404
        assert world.clients.rows == {}


class TestRegisterRateLimitCases:
    @staticmethod
    def test_registration_is_rate_limited_per_ip(world: _World) -> None:
        for _ in range(LIMIT_DCR_PER_IP.limit):
            assert _register(world).status_code == 201

        assert _register(world).status_code == 429
        assert list(world.hits.hits) == [f"{limiter_prefix(LIMIT_DCR_PER_IP)}:ip:127.0.0.1"]
