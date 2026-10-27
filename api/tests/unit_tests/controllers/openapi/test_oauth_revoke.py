from dataclasses import dataclass, field

import pytest
from flask import Flask

from configs import dify_config
from controllers.openapi import bp as openapi_bp
from services.oauth_grant_revoker import RevokeRequest
from services.oauth_token_contracts import TokenEndpointError, TokenErrorCode

_PATH = "/openapi/v1/oauth/revoke"


@dataclass
class _Revocation:
    error: TokenEndpointError | None = None
    seen: list[RevokeRequest] = field(default_factory=list)

    def revoke(self, request: RevokeRequest) -> None:
        self.seen.append(request)
        if self.error is not None:
            raise self.error


@dataclass
class _Services:
    oauth_revocation: _Revocation


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


def _install(app: Flask, revocation: _Revocation) -> _Revocation:
    app.extensions["application_services"] = _Services(oauth_revocation=revocation)
    return revocation


def test_revoke_answers_200_with_an_empty_body(app: Flask) -> None:
    revocation = _install(app, _Revocation())

    response = app.test_client().post(
        _PATH,
        data={"token": "dfor_x", "client_id": "qwenwork", "client_secret": "s3cret"},
        environ_overrides={"REMOTE_ADDR": "192.0.2.10"},
    )

    assert response.status_code == 200
    assert response.data == b""
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Pragma"] == "no-cache"
    assert revocation.seen == [
        RevokeRequest(client_id="qwenwork", client_secret="s3cret", token="dfor_x", source_ip="192.0.2.10")
    ]


def test_revoke_accepts_form_and_json(app: Flask) -> None:
    revocation = _install(app, _Revocation())
    fields = {"token": "dfoa_x", "client_id": "native-app"}

    form = app.test_client().post(_PATH, data=fields)
    as_json = app.test_client().post(_PATH, json=fields)

    assert form.status_code == as_json.status_code == 200
    assert revocation.seen[0] == revocation.seen[1]
    assert revocation.seen[0].client_secret is None


@pytest.mark.parametrize("hint", ["access_token", "refresh_token", "urn:x:future-type"])
def test_token_type_hint_is_ignored(app: Flask, hint: str) -> None:
    revocation = _install(app, _Revocation())

    response = app.test_client().post(_PATH, data={"token": "dfoa_x", "client_id": "c", "token_type_hint": hint})

    assert response.status_code == 200
    assert revocation.seen[0].token == "dfoa_x"


def test_basic_credentials_take_precedence_and_empty_secret_is_none(app: Flask) -> None:
    revocation = _install(app, _Revocation())

    app.test_client().post(
        _PATH,
        data={"token": "dfoa_x", "client_id": "body", "client_secret": "body-secret"},
        headers={"Authorization": "Basic Y2xpZW50JTNBaWQ6c2VjJTIwcmV0"},
    )
    app.test_client().post(_PATH, data={"token": "dfoa_x", "client_id": "native-app", "client_secret": ""})

    assert (revocation.seen[0].client_id, revocation.seen[0].client_secret) == ("client:id", "sec ret")
    assert revocation.seen[1].client_secret is None


def test_bad_client_answers_401_with_basic_challenge(app: Flask) -> None:
    _install(app, _Revocation(error=TokenEndpointError(TokenErrorCode.INVALID_CLIENT)))

    response = app.test_client().post(_PATH, data={"token": "dfoa_x", "client_id": "c", "client_secret": "bad"})

    assert response.status_code == 401
    assert response.get_json() == {"error": "invalid_client"}
    assert response.headers["WWW-Authenticate"] == 'Basic realm="dify-openapi"'
    assert response.headers["Cache-Control"] == "no-store"


def test_failure_limit_answers_429_without_challenge(app: Flask) -> None:
    _install(app, _Revocation(error=TokenEndpointError(TokenErrorCode.TEMPORARILY_UNAVAILABLE)))

    response = app.test_client().post(_PATH, data={"token": "dfoa_x", "client_id": "c", "client_secret": "bad"})

    assert response.status_code == 429
    assert response.get_json() == {"error": "temporarily_unavailable"}
    assert "WWW-Authenticate" not in response.headers


def test_non_string_json_field_is_invalid_request(app: Flask) -> None:
    revocation = _install(app, _Revocation())

    response = app.test_client().post(_PATH, json={"token": 7, "client_id": "c"})

    assert response.status_code == 400
    assert response.get_json() == {"error": "invalid_request"}
    assert revocation.seen == []


def test_revoke_works_with_authorization_code_logins_turned_off(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "ENABLE_OAUTH_AUTHORIZATION_CODE", False)
    _install(app, _Revocation())

    response = app.test_client().post(_PATH, data={"token": "dfoa_x", "client_id": "c"})

    assert response.status_code == 200
