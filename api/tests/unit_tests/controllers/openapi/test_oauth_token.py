from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from http import HTTPStatus

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.openapi import bp as openapi_bp
from controllers.openapi._oauth_input import basic_client_credentials, oauth_feature_required, read_oauth_body
from services.oauth_token_contracts import (
    GrantType,
    TokenEndpointError,
    TokenErrorCode,
    TokenGrantResult,
    TokenRequest,
)
from services.oauth_token_service import OAuthTokenService

_PATH = "/openapi/v1/oauth/token"


@dataclass
class _Handler:
    result: TokenGrantResult | None = None
    error: TokenEndpointError | None = None
    seen: list[TokenRequest] = field(default_factory=list)

    def __call__(self, request: TokenRequest) -> TokenGrantResult:
        self.seen.append(request)
        if self.error is not None:
            raise self.error
        assert self.result is not None
        return self.result


@dataclass
class _Services:
    oauth_token: OAuthTokenService


def _result(*, expires_in: int = 3600, refresh_token: str | None = None) -> TokenGrantResult:
    expires_at = (datetime.now(UTC) + timedelta(seconds=expires_in)).isoformat()
    return TokenGrantResult(
        payload={
            "token": "dfoa_secret",
            "expires_at": expires_at,
            "subject_type": "account",
            "account": {"id": "a1", "email": "ada@example.com", "name": "Ada"},
            "workspaces": [],
            "default_workspace_id": None,
            "token_id": "t1",
        },
        refresh_token=refresh_token,
    )


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


def _install(app: Flask, handler: _Handler) -> None:
    app.extensions["application_services"] = _Services(
        oauth_token=OAuthTokenService(handlers={GrantType.DEVICE_CODE: handler})
    )


def test_success_maps_to_token_response(app: Flask) -> None:
    handler = _Handler(result=_result(refresh_token="rt"))
    _install(app, handler)

    response = app.test_client().post(_PATH, data={"grant_type": GrantType.DEVICE_CODE, "scope": "x"})

    body = response.get_json()
    assert response.status_code == 200
    assert body["access_token"] == "dfoa_secret"
    assert body["token_type"] == "Bearer"
    assert 3590 <= body["expires_in"] <= 3600
    assert body["refresh_token"] == "rt"
    assert body["token_id"] == "t1"
    assert body["account"]["email"] == "ada@example.com"
    assert "scope" not in body
    assert "token" not in body
    assert "expires_at" not in body


def test_refresh_token_omitted_when_absent_and_expired_floors_at_zero(app: Flask) -> None:
    _install(app, _Handler(result=_result(expires_in=-30)))

    body = app.test_client().post(_PATH, data={"grant_type": GrantType.DEVICE_CODE}).get_json()

    assert "refresh_token" not in body
    assert body["expires_in"] == 0


def test_token_endpoint_accepts_form_and_json(app: Flask) -> None:
    handler = _Handler(result=_result())
    _install(app, handler)
    client = app.test_client()
    fields = {"grant_type": GrantType.DEVICE_CODE, "device_code": "dc", "client_id": "difyctl", "resource": "r"}

    form = client.post(_PATH, data=fields)
    as_json = client.post(_PATH, json=fields)

    assert form.status_code == as_json.status_code == 200
    assert handler.seen[0] == handler.seen[1]
    assert handler.seen[0].device_code == "dc"
    assert handler.seen[0].client_id == "difyctl"
    assert handler.seen[0].resource == "r"
    assert form.get_json()["access_token"] == as_json.get_json()["access_token"]


def test_token_endpoint_sets_no_store(app: Flask) -> None:
    _install(app, _Handler(result=_result()))

    ok = app.test_client().post(_PATH, data={"grant_type": GrantType.DEVICE_CODE})
    failed = app.test_client().post(_PATH, data={"grant_type": "password"})

    for response in (ok, failed):
        assert response.headers["Cache-Control"] == "no-store"
        assert response.headers["Pragma"] == "no-cache"


def test_unknown_grant_returns_oauth_error_body(app: Flask) -> None:
    _install(app, _Handler(result=_result()))

    response = app.test_client().post(_PATH, data={"grant_type": "urn:x:future"})

    assert response.status_code == 400
    assert response.get_json() == {"error": "unsupported_grant_type"}


def test_401_sends_basic_challenge_and_other_errors_do_not(app: Flask) -> None:
    _install(app, _Handler(error=TokenEndpointError(TokenErrorCode.INVALID_CLIENT, HTTPStatus.UNAUTHORIZED)))
    unauthorized = app.test_client().post(_PATH, data={"grant_type": GrantType.DEVICE_CODE})
    _install(app, _Handler(error=TokenEndpointError(TokenErrorCode.SLOW_DOWN)))
    slow = app.test_client().post(_PATH, data={"grant_type": GrantType.DEVICE_CODE})

    assert unauthorized.status_code == 401
    assert unauthorized.get_json() == {"error": "invalid_client"}
    assert unauthorized.headers["WWW-Authenticate"] == 'Basic realm="dify-openapi"'
    assert slow.status_code == 400
    assert "WWW-Authenticate" not in slow.headers


def test_basic_credentials_take_precedence_and_ip_and_origin_are_passed(app: Flask) -> None:
    handler = _Handler(result=_result())
    _install(app, handler)

    app.test_client().post(
        _PATH,
        data={"grant_type": GrantType.DEVICE_CODE, "client_id": "body", "client_secret": "body-secret"},
        headers={"Authorization": "Basic Y2xpZW50JTNBaWQ6c2VjJTIwcmV0"},
        environ_overrides={"REMOTE_ADDR": "192.0.2.10"},
    )

    seen = handler.seen[0]
    assert (seen.client_id, seen.client_secret) == ("client:id", "sec ret")
    assert seen.poll_ip == "192.0.2.10"
    assert seen.request_origin == "http://localhost/"


def test_read_oauth_body_and_basic_credentials(app: Flask) -> None:
    with app.test_request_context(method="POST", data={"a": "1", "b": "2"}):
        assert read_oauth_body() == {"a": "1", "b": "2"}
    with app.test_request_context(method="POST", json={"a": "1", "n": 2, "l": ["x"], "z": None}):
        assert read_oauth_body() == {"a": "1"}
    with app.test_request_context(method="POST", json=["a"]):
        assert read_oauth_body() == {}
    with app.test_request_context(method="POST", data="{", content_type="application/json"):
        assert read_oauth_body() == {}

    with app.test_request_context(headers={"Authorization": "Basic YSUyQmI6YytkJTI1"}):
        assert basic_client_credentials() == ("a+b", "c d%")
    with app.test_request_context(headers={"Authorization": "Bearer abc"}):
        assert basic_client_credentials() is None
    with app.test_request_context():
        assert basic_client_credentials() is None


def test_oauth_feature_required_passes_when_enabled_and_404s_when_disabled() -> None:
    @oauth_feature_required(lambda: True)
    def enabled_view() -> str:
        return "ok"

    @oauth_feature_required(lambda: False)
    def disabled_view() -> str:
        return "ok"

    assert enabled_view() == "ok"
    with pytest.raises(NotFound):
        disabled_view()
