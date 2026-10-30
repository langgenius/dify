from collections.abc import Callable

import pytest
from flask import Flask
from flask.testing import FlaskClient

from controllers.well_known import bp as well_known_bp

AS_PATH = "/.well-known/oauth-authorization-server/openapi/v1"
PR_PATH = "/.well-known/oauth-protected-resource/openapi/v1"
PR_ROOT_PATH = "/.well-known/oauth-protected-resource"
API_ORIGIN = "https://api.dify.test"
ConfigOverrides = Callable[..., None]


@pytest.fixture
def client(config_overrides: ConfigOverrides) -> FlaskClient:
    config_overrides(
        CONSOLE_API_URL=API_ORIGIN,
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


@pytest.mark.parametrize("path", [AS_PATH, PR_PATH, PR_ROOT_PATH])
def test_documents_are_json_cached_and_cors_open(client: FlaskClient, path: str) -> None:
    resp = client.get(path, base_url="http://dify.test")
    assert resp.status_code == 200
    assert resp.mimetype == "application/json"
    assert resp.headers["Cache-Control"] == "public, max-age=3600"
    assert resp.headers["Access-Control-Allow-Origin"] == "*"


def test_authorization_server_uses_console_api_url(client: FlaskClient) -> None:
    body = client.get(AS_PATH, base_url="http://dify.test").get_json()
    assert body["issuer"] == f"{API_ORIGIN}/openapi/v1"
    assert body["authorization_endpoint"] == "http://dify.test/account/oauth/authorize"


def test_root_protected_resource_document_matches_the_path_suffixed_one(client: FlaskClient) -> None:
    root = client.get(PR_ROOT_PATH, base_url="http://dify.test").get_json()

    assert root == client.get(PR_PATH, base_url="http://dify.test").get_json()
    assert root["resource"] == f"{API_ORIGIN}/openapi/v1"


@pytest.mark.parametrize("override", [{"ENABLE_OAUTH_BEARER": False}, {"CONSOLE_API_URL": ""}])
@pytest.mark.parametrize("path", [AS_PATH, PR_PATH, PR_ROOT_PATH])
def test_documents_are_404_when_discovery_is_off(
    client: FlaskClient, config_overrides: ConfigOverrides, path: str, override: dict[str, object]
) -> None:
    config_overrides(**override)
    assert client.get(path, base_url="http://dify.test").status_code == 404
