"""CORS posture for /openapi/v1/* — default empty allowlist (same-origin),
expandable via OPENAPI_CORS_ALLOW_ORIGINS. Cross-origin requests from
disallowed origins do not receive the Access-Control-Allow-Origin
header, which the browser then blocks.

Tests use a fresh Blueprint + Flask-CORS per case because the production
blueprint is a module-level singleton and can't be reconfigured once
registered.
"""

import builtins

from flask import Blueprint, Flask
from flask.views import MethodView
from flask_cors import CORS
from flask_restx import Resource

from configs import dify_config
from extensions.ext_blueprints import OPENAPI_HEADERS, OPENAPI_MAX_AGE_SECONDS
from libs.external_api import ExternalApi

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


def _make_app(allowed_origins: list[str], blueprint_name: str) -> Flask:
    """Build a Flask app with a fresh openapi-style blueprint mirroring
    production CORS settings, parameterised on the origin allowlist.
    """
    bp = Blueprint(blueprint_name, __name__, url_prefix="/openapi/v1")
    api = ExternalApi(bp, version="1.0", title="OpenAPI Test", description="")

    @api.route("/_health")
    class _Health(Resource):
        def get(self):
            return {"ok": True}

    CORS(
        bp,
        resources={r"/*": {"origins": allowed_origins}},
        supports_credentials=True,
        allow_headers=list(OPENAPI_HEADERS),
        methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        expose_headers=["X-Version"],
        max_age=OPENAPI_MAX_AGE_SECONDS,
    )

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    return app


def test_default_openapi_cors_allowlist_is_empty():
    """Default config admits no cross-origin until operator opts in."""
    assert dify_config.OPENAPI_CORS_ALLOW_ORIGINS == []


def test_preflight_allowed_origin_returns_cors_headers():
    app = _make_app(["https://app.example.com"], "openapi_t1")
    client = app.test_client()
    response = client.options(
        "/openapi/v1/_health",
        headers={
            "Origin": "https://app.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.headers.get("Access-Control-Allow-Origin") == "https://app.example.com"
    assert response.headers.get("Access-Control-Max-Age") == str(OPENAPI_MAX_AGE_SECONDS)


def test_preflight_disallowed_origin_omits_cors_headers():
    app = _make_app(["https://app.example.com"], "openapi_t2")
    client = app.test_client()
    response = client.options(
        "/openapi/v1/_health",
        headers={
            "Origin": "https://attacker.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    # flask-cors omits Allow-Origin for disallowed origins; browser blocks.
    assert "Access-Control-Allow-Origin" not in response.headers


def test_preflight_with_default_empty_allowlist_omits_cors_headers():
    app = _make_app([], "openapi_t3")
    client = app.test_client()
    response = client.options(
        "/openapi/v1/_health",
        headers={
            "Origin": "https://app.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert "Access-Control-Allow-Origin" not in response.headers


def test_same_origin_request_succeeds_without_origin_header():
    app = _make_app(["https://app.example.com"], "openapi_t4")
    client = app.test_client()
    # Browsers don't send Origin on same-origin GETs.
    response = client.get("/openapi/v1/_health")

    assert response.status_code == 200
    assert response.get_json() == {"ok": True}


def test_authorization_header_is_in_allow_headers():
    """Bearer-authed routes need Authorization in the preflight response."""
    app = _make_app(["https://app.example.com"], "openapi_t5")
    client = app.test_client()
    response = client.options(
        "/openapi/v1/_health",
        headers={
            "Origin": "https://app.example.com",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        },
    )

    allow_headers = response.headers.get("Access-Control-Allow-Headers", "").lower()
    assert "authorization" in allow_headers
