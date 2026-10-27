from collections.abc import Callable

import pytest
from flask import Flask
from flask.testing import FlaskClient

from controllers.well_known import bp as well_known_bp

AS_PATH = "/.well-known/oauth-authorization-server/openapi/v1"
PR_PATH = "/.well-known/oauth-protected-resource/openapi/v1"
ConfigOverrides = Callable[..., None]


@pytest.fixture
def client(config_overrides: ConfigOverrides) -> FlaskClient:
    config_overrides(
        CONSOLE_API_URL=None,
        CONSOLE_WEB_URL=None,
        ENABLE_OAUTH_BEARER=True,
        ENABLE_OAUTH_AUTHORIZATION_CODE=True,
        ENABLE_OAUTH_DCR=True,
        ENABLE_OAUTH_CIMD=True,
    )
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(well_known_bp)
    return app.test_client()


@pytest.mark.parametrize("path", [AS_PATH, PR_PATH])
def test_documents_are_json_cached_and_cors_open(client: FlaskClient, path: str) -> None:
    resp = client.get(path, base_url="http://dify.test")
    assert resp.status_code == 200
    assert resp.mimetype == "application/json"
    assert resp.headers["Cache-Control"] == "public, max-age=3600"
    assert resp.headers["Access-Control-Allow-Origin"] == "*"


def test_authorization_server_uses_request_origin(client: FlaskClient) -> None:
    body = client.get(AS_PATH, base_url="http://dify.test").get_json()
    assert body["issuer"] == "http://dify.test/openapi/v1"
    assert body["registration_endpoint"] == "http://dify.test/openapi/v1/oauth/register"
    assert body["authorization_endpoint"] == "http://dify.test/account/oauth/authorize"


def test_protected_resource_document(client: FlaskClient) -> None:
    body = client.get(PR_PATH, base_url="http://dify.test").get_json()
    assert body == {
        "resource": "http://dify.test/openapi/v1",
        "authorization_servers": ["http://dify.test/openapi/v1"],
        "bearer_methods_supported": ["header"],
    }


@pytest.mark.parametrize("path", [AS_PATH, PR_PATH])
def test_bearer_off_is_404(client: FlaskClient, config_overrides: ConfigOverrides, path: str) -> None:
    config_overrides(ENABLE_OAUTH_BEARER=False)
    assert client.get(path, base_url="http://dify.test").status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/.well-known/openid-configuration",
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server/openapi/v2",
        "/.well-known/oauth-protected-resource",
    ],
)
def test_other_well_known_paths_are_not_served(client: FlaskClient, path: str) -> None:
    assert client.get(path, base_url="http://dify.test").status_code == 404
