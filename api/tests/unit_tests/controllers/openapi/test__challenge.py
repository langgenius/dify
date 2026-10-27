from collections.abc import Callable

import pytest
from flask import Blueprint, Flask, Response, jsonify
from flask.testing import FlaskClient

from controllers.openapi._challenge import attach_resource_metadata_challenge

ORIGIN = "http://dify.test"
API_ORIGIN = "https://api.dify.test"
METADATA = f"{API_ORIGIN}/.well-known/oauth-protected-resource/openapi/v1"
ConfigOverrides = Callable[..., None]


def _reply(status: int, challenge: str | None = None) -> Response:
    response = jsonify({"code": "x"})
    response.status_code = status
    if challenge is not None:
        response.headers["WWW-Authenticate"] = challenge
    return response


@pytest.fixture
def client(config_overrides: ConfigOverrides) -> FlaskClient:
    config_overrides(CONSOLE_API_URL=API_ORIGIN, ENABLE_OAUTH_BEARER=True)
    bp = Blueprint("challenge_test", __name__, url_prefix="/openapi/v1")
    attach_resource_metadata_challenge(bp)

    @bp.get("/bare")
    def bare() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(401)

    @bp.get("/realm")
    def realm() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(401, 'Bearer realm="api"')

    @bp.post("/oauth/token")
    def token() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _reply(401, 'Basic realm="oauth"')

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    return app.test_client()


def _challenge(client: FlaskClient, path: str, method: str = "GET") -> str | None:
    response = client.open(f"/openapi/v1{path}", method=method, base_url=ORIGIN)
    return response.headers.get("WWW-Authenticate")


def test_401_challenges_gain_the_resource_metadata(client: FlaskClient) -> None:
    assert _challenge(client, "/bare") == f'Bearer resource_metadata="{METADATA}"'
    assert _challenge(client, "/realm") == f'Bearer realm="api", resource_metadata="{METADATA}"'


def test_oauth_endpoints_are_left_alone(client: FlaskClient) -> None:
    assert _challenge(client, "/oauth/token", "POST") == 'Basic realm="oauth"'


@pytest.mark.parametrize("override", [{"CONSOLE_API_URL": ""}, {"ENABLE_OAUTH_BEARER": False}])
def test_nothing_is_advertised_when_discovery_is_off(
    client: FlaskClient, config_overrides: ConfigOverrides, override: dict[str, object]
) -> None:
    config_overrides(**override)
    assert _challenge(client, "/bare") is None
    assert _challenge(client, "/realm") == 'Bearer realm="api"'


def test_real_blueprint_401_carries_the_challenge(openapi_app: Flask, config_overrides: ConfigOverrides) -> None:
    config_overrides(CONSOLE_API_URL=API_ORIGIN, ENABLE_OAUTH_BEARER=True)
    response = openapi_app.test_client().get("/openapi/v1/account", base_url=ORIGIN)
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"].endswith(f'resource_metadata="{METADATA}"')
