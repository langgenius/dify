from dataclasses import dataclass, field

import pytest
from flask import Flask

from configs import dify_config
from controllers.openapi import bp as openapi_bp
from services.oauth_grant_revoker import RevokeRequest

_PATH = "/openapi/v1/oauth/revoke"


@dataclass
class _Revocation:
    seen: list[RevokeRequest] = field(default_factory=list)

    def revoke(self, request: RevokeRequest) -> None:
        self.seen.append(request)


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


def test_revoke_answers_200_with_an_empty_body_and_ignores_the_type_hint(app: Flask) -> None:
    revocation = _install(app, _Revocation())

    response = app.test_client().post(
        _PATH,
        data={"token": "dfor_x", "client_id": "qwenwork", "client_secret": "s3cret", "token_type_hint": "urn:x:future"},
    )

    assert response.status_code == 200
    assert response.data == b""
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Pragma"] == "no-cache"
    assert revocation.seen == [RevokeRequest(client_id="qwenwork", client_secret="s3cret", token="dfor_x")]


def test_revoke_works_with_authorization_code_logins_off_and_reads_an_empty_secret_as_none(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dify_config, "ENABLE_OAUTH_AUTHORIZATION_CODE", False)
    revocation = _install(app, _Revocation())

    response = app.test_client().post(_PATH, data={"token": "dfoa_x", "client_id": "c", "client_secret": ""})

    assert response.status_code == 200
    assert revocation.seen[0].client_secret is None
