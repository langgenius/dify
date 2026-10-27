from collections.abc import Callable

import pytest
from flask import Blueprint, Flask, Response, jsonify
from flask.testing import FlaskClient

from controllers.openapi._challenge import attach_resource_metadata_challenge

ORIGIN = "http://dify.test"
METADATA = f"{ORIGIN}/.well-known/oauth-protected-resource/openapi/v1"
ConfigOverrides = Callable[..., None]


def _reply(status: int, challenge: str | None = None) -> Response:
    response = jsonify({"code": "x"})
    response.status_code = status
    if challenge is not None:
        response.headers["WWW-Authenticate"] = challenge
    return response


@pytest.fixture
def client(config_overrides: ConfigOverrides) -> FlaskClient:
    config_overrides(CONSOLE_API_URL=None, ENABLE_OAUTH_BEARER=True)
    bp = Blueprint("challenge_test", __name__, url_prefix="/openapi/v1")
    attach_resource_metadata_challenge(bp)

    @bp.get("/bare")
    def bare() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(401)

    @bp.get("/realm")
    def realm() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(401, 'Bearer realm="api"')

    @bp.get("/lower")
    def lower() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(401, 'bearer realm="api"')

    @bp.get("/already")
    def already() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(401, 'Bearer resource_metadata="http://other/x"')

    @bp.get("/basic")
    def basic() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(401, 'Basic realm="x"')

    @bp.get("/forbidden")
    def forbidden() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(403)

    @bp.get("/ok")
    def ok() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(200)

    @bp.post("/oauth/token")
    def token() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(401, 'Basic realm="oauth"')

    @bp.post("/oauth/other")
    def oauth_other() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(401)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    return app.test_client()


def _challenge(client: FlaskClient, path: str, method: str = "GET") -> str | None:
    response = client.open(f"/openapi/v1{path}", method=method, base_url=ORIGIN)
    return response.headers.get("WWW-Authenticate")


def test_missing_challenge_is_set(client: FlaskClient) -> None:
    assert _challenge(client, "/bare") == f'Bearer resource_metadata="{METADATA}"'


@pytest.mark.parametrize("path", ["/realm", "/lower"])
def test_bearer_challenge_gains_the_parameter(client: FlaskClient, path: str) -> None:
    existing = 'Bearer realm="api"' if path == "/realm" else 'bearer realm="api"'
    assert _challenge(client, path) == f'{existing}, resource_metadata="{METADATA}"'


def test_existing_resource_metadata_is_kept(client: FlaskClient) -> None:
    assert _challenge(client, "/already") == 'Bearer resource_metadata="http://other/x"'


def test_non_bearer_challenge_is_untouched(client: FlaskClient) -> None:
    assert _challenge(client, "/basic") == 'Basic realm="x"'


@pytest.mark.parametrize("path", ["/forbidden", "/ok"])
def test_other_statuses_get_no_header(client: FlaskClient, path: str) -> None:
    assert _challenge(client, path) is None


def test_oauth_endpoints_are_left_alone(client: FlaskClient) -> None:
    assert _challenge(client, "/oauth/token", "POST") == 'Basic realm="oauth"'
    assert _challenge(client, "/oauth/other", "POST") is None


def test_body_and_status_are_untouched(client: FlaskClient) -> None:
    response = client.get("/openapi/v1/realm", base_url=ORIGIN)
    assert response.status_code == 401
    assert response.get_json() == {"code": "x"}


def test_console_api_url_is_used(client: FlaskClient, config_overrides: ConfigOverrides) -> None:
    config_overrides(CONSOLE_API_URL="https://console.example.com")
    assert _challenge(client, "/bare") == (
        'Bearer resource_metadata="https://console.example.com/.well-known/oauth-protected-resource/openapi/v1"'
    )


def test_bearer_off_advertises_nothing(client: FlaskClient, config_overrides: ConfigOverrides) -> None:
    config_overrides(ENABLE_OAUTH_BEARER=False)
    assert _challenge(client, "/bare") is None
    assert _challenge(client, "/realm") == 'Bearer realm="api"'


def test_real_blueprint_401_carries_the_challenge(openapi_app: Flask, config_overrides: ConfigOverrides) -> None:
    config_overrides(CONSOLE_API_URL=None, ENABLE_OAUTH_BEARER=True)
    response = openapi_app.test_client().get("/openapi/v1/account", base_url=ORIGIN)
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"].endswith(f'resource_metadata="{METADATA}"')
