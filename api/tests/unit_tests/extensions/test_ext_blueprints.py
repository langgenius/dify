from __future__ import annotations

import builtins
import importlib

import pytest
from flask import Blueprint, Flask, Response
from flask.views import MethodView
from flask_cors import CORS
from flask_restx import Resource

from configs import dify_config
from constants import HEADER_NAME_CATALOG
from dify_app import DifyApp
from extensions import ext_blueprints
from extensions.ext_blueprints import (
    AUTHENTICATED_HEADERS,
    EXPOSED_HEADERS,
    OPENAPI_HEADERS,
    OPENAPI_MAX_AGE_SECONDS,
    _apply_cors_once,
)
from libs.external_api import ExternalApi
from tests.helpers.unit.config_override import apply_config_overrides

"""CORS posture for /openapi/v1/* — default empty allowlist (same-origin),
expandable via OPENAPI_CORS_ALLOW_ORIGINS. Cross-origin requests from
disallowed origins do not receive the Access-Control-Allow-Origin
header, which the browser then blocks.

Tests use a fresh Blueprint + Flask-CORS per case because the production
blueprint is a module-level singleton and can't be reconfigured once
registered.
"""


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
        def get(self) -> dict[str, bool]:
            return {"ok": True}

    CORS(
        bp,
        resources={r"/*": {"origins": allowed_origins}},
        supports_credentials=True,
        allow_headers=list(OPENAPI_HEADERS),
        methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        expose_headers=list(EXPOSED_HEADERS),
        max_age=OPENAPI_MAX_AGE_SECONDS,
    )

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    return app


class TestCorsCases:
    from tests.unit_tests.controllers.conftest import error_response_contract

    error_response_contract = staticmethod(error_response_contract)

    from tests.unit_tests.controllers.conftest import datasource_application_dependencies

    datasource_application_dependencies = staticmethod(datasource_application_dependencies)

    from tests.unit_tests.controllers.conftest import pipeline_application

    pipeline_application = staticmethod(pipeline_application)

    from tests.unit_tests.controllers.conftest import app_query_services

    app_query_services = staticmethod(app_query_services)

    from tests.unit_tests.controllers.openapi.conftest import openapi_app

    openapi_app = staticmethod(openapi_app)

    from tests.unit_tests.controllers.openapi.conftest import app

    app = staticmethod(app)

    from tests.unit_tests.controllers.openapi.conftest import admitted_bearer

    admitted_bearer = staticmethod(admitted_bearer)

    from tests.unit_tests.controllers.openapi.conftest import _account_services

    _account_services = staticmethod(_account_services)

    @staticmethod
    def test_default_openapi_cors_allowlist_is_empty() -> None:
        """Default config admits no cross-origin until operator opts in."""
        assert dify_config.OPENAPI_CORS_ALLOW_ORIGINS == []

    @staticmethod
    def test_preflight_allowed_origin_returns_cors_headers() -> None:
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

    @staticmethod
    def test_preflight_disallowed_origin_omits_cors_headers() -> None:
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

    @staticmethod
    def test_preflight_with_default_empty_allowlist_omits_cors_headers() -> None:
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

    @staticmethod
    def test_same_origin_request_succeeds_without_origin_header() -> None:
        app = _make_app(["https://app.example.com"], "openapi_t4")
        client = app.test_client()
        # Browsers don't send Origin on same-origin GETs.
        response = client.get("/openapi/v1/_health")

        assert response.status_code == 200
        assert response.get_json() == {"ok": True}

    @staticmethod
    def test_authorization_header_is_in_allow_headers() -> None:
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

    @staticmethod
    def test_catalog_fingerprint_header_is_exposed() -> None:
        app = _make_app(["https://app.example.com"], "openapi_t6")
        client = app.test_client()
        response = client.get("/openapi/v1/_health", headers={"Origin": "https://app.example.com"})

        expose_headers = response.headers.get("Access-Control-Expose-Headers", "")
        assert HEADER_NAME_CATALOG in expose_headers

    @staticmethod
    def test_catalog_fingerprint_header_is_allowed_on_requests() -> None:
        """Every guarded route needs the fingerprint on the request, so preflight must admit it."""
        app = _make_app(["https://app.example.com"], "openapi_t7")
        client = app.test_client()
        response = client.options(
            "/openapi/v1/_health",
            headers={
                "Origin": "https://app.example.com",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": HEADER_NAME_CATALOG,
            },
        )

        allow_headers = response.headers.get("Access-Control-Allow-Headers", "").lower()
        assert HEADER_NAME_CATALOG.lower() in allow_headers


"""Regression coverage for authenticated browser CORS headers."""


class TestExtBlueprintsCorsCases:
    @staticmethod
    def test_authenticated_cors_allows_request_metadata_headers() -> None:
        app = Flask(__name__)
        blueprint = Blueprint("cors_probe", __name__, url_prefix="/console/api")

        @blueprint.post("/probe")
        def probe() -> tuple[str, int]:
            return "", 204

        _apply_cors_once(
            blueprint,
            resources={r"/*": {"origins": ["http://localhost:3000"]}},
            supports_credentials=True,
            allow_headers=list(AUTHENTICATED_HEADERS),
            methods=["POST", "OPTIONS"],
        )
        app.register_blueprint(blueprint)

        response = app.test_client().options(
            "/console/api/probe",
            headers={
                "Access-Control-Request-Headers": "Idempotency-Key, X-Request-ID, X-Trace-ID",
                "Access-Control-Request-Method": "POST",
                "Origin": "http://localhost:3000",
            },
        )

        allowed_headers = response.headers.get("Access-Control-Allow-Headers", "").lower()
        assert "idempotency-key" in allowed_headers
        assert "x-request-id" in allowed_headers
        assert "x-trace-id" in allowed_headers


"""Verifies the OPENAPI_ENABLED gate in `extensions.ext_blueprints.init_app`.

Contract:
- When `dify_config.OPENAPI_ENABLED` is True, the `/openapi/v1/*` blueprint
  must be registered on the Flask app AND have CORS configured (signalled
  by the idempotent `_dify_cors_applied` marker that `_apply_cors_once`
  sets after wiring `flask_cors.CORS`).
- When False, the openapi blueprint must NOT be registered and CORS must
  NOT be wired for it. The cross-origin posture is otherwise undefined for
  the disabled feature.

Why the blueprints are swapped for fresh ones:
`init_app` operates on module-level blueprint singletons (e.g.
`controllers.service_api.bp`). Other unit tests register those same
singletons onto throwaway Flask apps without going through `init_app`
(see `tests/unit_tests/controllers/service_api/test___init__.py` and the
`tests/unit_tests/controllers/openapi/*` suite). Once a blueprint has
been registered to any app, Flask flips `_got_registered_once = True`
and rejects further `after_request` hookup -- which is what
`flask_cors.CORS(bp, ...)` does internally. To make this gate test
order-independent we monkeypatch each consumed `controllers.<ns>.bp` to
a pristine, never-registered `Blueprint` for the duration of the test.
`init_app` resolves these via `from controllers.<ns> import bp as ...`
inside its function body, so the patched value is what it sees.
"""


# Modules whose `bp` attribute is consumed by `ext_blueprints.init_app`.
# Keep in sync with the imports inside `init_app`.
_BLUEPRINT_MODULES: tuple[str, ...] = (
    "controllers.console",
    "controllers.files",
    "controllers.inner_api",
    "controllers.mcp",
    "controllers.openapi",
    "controllers.service_api",
    "controllers.trigger",
    "controllers.web",
)


def _probe_view() -> tuple[str, int]:
    return "ok", 200


def _download_probe_view() -> Response:
    response = Response("document", content_type="text/plain")
    response.headers["Content-Disposition"] = "attachment; filename=document.txt"
    return response


def _build_app() -> DifyApp:
    app = DifyApp(__name__)
    app.config["TESTING"] = True
    return app


class TestExtBlueprintsOpenapiCases:
    @staticmethod
    @pytest.fixture
    def fresh_blueprints(monkeypatch: pytest.MonkeyPatch) -> dict[str, Blueprint]:
        """Replace each production blueprint singleton with a fresh, unregistered copy.

        Mirrors the production `name` and `url_prefix` so the gate can still
        be asserted via `app.blueprints[...]` and url_map prefix checks. The
        openapi replacement gets a dummy `/_probe` rule so the test can
        observe at least one `/openapi/v1/*` rule after registration.
        """
        fresh: dict[str, Blueprint] = {}
        for module_name in _BLUEPRINT_MODULES:
            module = importlib.import_module(module_name)
            original = module.bp
            replacement = Blueprint(
                original.name,
                original.import_name,
                url_prefix=original.url_prefix,
            )
            if module_name == "controllers.openapi":
                replacement.add_url_rule("/_probe", endpoint="_probe", view_func=_probe_view)
            if module_name == "controllers.console":
                replacement.add_url_rule("/_download", endpoint="_download", view_func=_download_probe_view)
            monkeypatch.setattr(module, "bp", replacement)
            fresh[module_name] = replacement
        return fresh

    @staticmethod
    def test_openapi_blueprint_registered_with_cors_when_enabled(
        monkeypatch: pytest.MonkeyPatch,
        fresh_blueprints: dict[str, Blueprint],
    ) -> None:
        """Enabled gate: blueprint mounted, CORS wired, `/openapi/v1/*` rules live."""
        apply_config_overrides(monkeypatch, OPENAPI_ENABLED=True)

        app = _build_app()
        ext_blueprints.init_app(app)

        openapi_bp = fresh_blueprints["controllers.openapi"]
        assert "openapi" in app.blueprints
        assert app.blueprints["openapi"] is openapi_bp
        # `_apply_cors_once` only sets this after wiring flask_cors.CORS, so
        # it is a faithful proxy for "CORS was applied to this blueprint".
        assert getattr(openapi_bp, "_dify_cors_applied", False) is True

        openapi_rules = [r for r in app.url_map.iter_rules() if r.rule.startswith("/openapi/v1")]
        assert openapi_rules, "expected at least one /openapi/v1/* route once enabled"

    @staticmethod
    def test_openapi_blueprint_absent_when_disabled(
        monkeypatch: pytest.MonkeyPatch,
        fresh_blueprints: dict[str, Blueprint],
    ) -> None:
        """Disabled gate: no blueprint, no CORS, no `/openapi/v1/*` URL rules."""
        apply_config_overrides(monkeypatch, OPENAPI_ENABLED=False)

        app = _build_app()
        ext_blueprints.init_app(app)

        openapi_bp = fresh_blueprints["controllers.openapi"]
        assert "openapi" not in app.blueprints
        # No CORS wiring should have run for the openapi blueprint.
        assert not hasattr(openapi_bp, "_dify_cors_applied")
        openapi_rules = [r for r in app.url_map.iter_rules() if r.rule.startswith("/openapi/v1")]
        assert openapi_rules == []

    @staticmethod
    def test_console_cors_exposes_download_filename(
        monkeypatch: pytest.MonkeyPatch,
        fresh_blueprints: dict[str, Blueprint],
    ) -> None:
        origin = "http://localhost:3000"
        apply_config_overrides(
            monkeypatch,
            OPENAPI_ENABLED=False,
            inner_CONSOLE_CORS_ALLOW_ORIGINS=origin,
        )

        app = _build_app()
        ext_blueprints.init_app(app)
        console_bp = fresh_blueprints["controllers.console"]
        assert app.blueprints[console_bp.name] is console_bp

        response = app.test_client().get(
            "/console/api/_download",
            headers={"Origin": origin},
        )

        exposed_headers = {
            header.strip().lower() for header in response.headers["Access-Control-Expose-Headers"].split(",")
        }
        assert "content-disposition" in exposed_headers
