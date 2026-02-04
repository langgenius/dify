import builtins
import contextlib
import importlib
import sys
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.exceptions import Unauthorized

from extensions import ext_fastopenapi
from extensions.ext_database import db
from services.feature_service import FeatureModel, SystemFeatureModel

# ------------------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------------------


@pytest.fixture
def app():
    """Creates a Flask app configured for testing."""
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret"
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    db.init_app(app)
    return app


@pytest.fixture(autouse=True)
def fix_method_view_issue(monkeypatch):
    """Patches builtins.MethodView for legacy compatibility."""
    if not hasattr(builtins, "MethodView"):
        monkeypatch.setattr(builtins, "MethodView", MethodView, raising=False)


def _create_isolated_router():
    """Creates a fresh router instance to prevent route pollution."""
    import controllers.fastopenapi

    RouterClass = type(controllers.fastopenapi.console_router)
    return RouterClass()


@contextlib.contextmanager
def _patch_auth_and_router(temp_router):
    """Patches console_router and authentication decorators."""

    def noop(f):
        return f

    with (
        patch("controllers.fastopenapi.console_router", temp_router),
        patch("extensions.ext_fastopenapi.console_router", temp_router),
        patch("controllers.console.wraps.setup_required", side_effect=noop),
        patch("libs.login.login_required", side_effect=noop),
        patch("controllers.console.wraps.account_initialization_required", side_effect=noop),
        patch("controllers.console.wraps.cloud_utm_record", side_effect=noop),
        patch("libs.login.current_account_with_tenant", return_value=(MagicMock(), "tenant-id")),
        patch("libs.login.current_user", MagicMock(is_authenticated=True)),
    ):
        import extensions.ext_fastopenapi

        importlib.reload(extensions.ext_fastopenapi)
        yield


def _force_reload_module(target_module: str, alias_module: str):
    """Forces module reload to apply patches to decorators at import time."""
    if target_module in sys.modules:
        del sys.modules[target_module]
    if alias_module in sys.modules:
        del sys.modules[alias_module]

    module = importlib.import_module(target_module)
    sys.modules[alias_module] = sys.modules[target_module]
    return module


@pytest.fixture
def mock_feature_module_env():
    """Sets up mocked environment for feature module with isolated router."""
    target_module = "controllers.console.feature"
    alias_module = "api.controllers.console.feature"

    temp_router = _create_isolated_router()

    try:
        with _patch_auth_and_router(temp_router):
            feature_module = _force_reload_module(target_module, alias_module)
            yield feature_module
    finally:
        if target_module in sys.modules:
            del sys.modules[target_module]
        if alias_module in sys.modules:
            del sys.modules[alias_module]


# ------------------------------------------------------------------------------
# Core Feature Endpoint Tests
# ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("url", "service_mock_path", "mock_model"),
    [
        (
            "/console/api/features",
            "controllers.console.feature.FeatureService.get_features",
            FeatureModel(can_replace_logo=True),
        ),
        (
            "/console/api/system-features",
            "controllers.console.feature.FeatureService.get_system_features",
            SystemFeatureModel(enable_marketplace=True),
        ),
    ],
)
def test_console_features_success(app, mock_feature_module_env, url, service_mock_path, mock_model):
    """Tests 200 response with flat JSON format and correct Content-Type."""
    with patch(service_mock_path, return_value=mock_model):
        ext_fastopenapi.init_app(app)
        response = app.test_client().get(url)

    assert response.status_code == 200, f"Failed: {response.text}"
    assert response.get_json() == mock_model.model_dump(mode="json")
    assert "application/json" in response.content_type


@pytest.mark.parametrize(
    ("url", "service_mock_path"),
    [
        ("/console/api/features", "controllers.console.feature.FeatureService.get_features"),
        ("/console/api/system-features", "controllers.console.feature.FeatureService.get_system_features"),
    ],
)
def test_console_features_service_error(app, mock_feature_module_env, url, service_mock_path):
    """Tests that service errors return 500."""
    with patch(service_mock_path, side_effect=ValueError("Service Failure")):
        ext_fastopenapi.init_app(app)
        response = app.test_client().get(url)

    assert response.status_code == 500


def test_system_features_unauthenticated(app, mock_feature_module_env):
    """Tests /system-features passes is_authenticated=False when auth fails."""
    feature_module = mock_feature_module_env
    type(feature_module.current_user).is_authenticated = PropertyMock(side_effect=Unauthorized)

    mock_model = SystemFeatureModel(enable_marketplace=True)
    with patch("controllers.console.feature.FeatureService.get_system_features", return_value=mock_model) as svc:
        ext_fastopenapi.init_app(app)
        response = app.test_client().get("/console/api/system-features")

    assert response.status_code == 200
    svc.assert_called_once_with(is_authenticated=False)
    assert response.get_json() == mock_model.model_dump(mode="json")


# ------------------------------------------------------------------------------
# FastOpenAPI Route Behavior Tests
# ------------------------------------------------------------------------------


class TestFastOpenAPIRouteBehavior:
    """Tests for FastOpenAPI-specific routing behavior."""

    @pytest.fixture
    def app_with_login_manager(self):
        """Creates Flask app with login manager configured."""
        from flask_login import LoginManager

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret"
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        db.init_app(app)

        login_manager = LoginManager()
        login_manager.init_app(app)

        @login_manager.unauthorized_handler
        def handle_unauthorized():
            from flask import request

            if request.blueprint is None and request.path.startswith("/console/api/"):
                raise Unauthorized("Unauthorized.")
            import json

            from flask import Response

            return Response(json.dumps({"code": "unauthorized"}), status=401, content_type="application/json")

        return app

    def test_fastopenapi_route_has_no_blueprint(self, app_with_login_manager, fix_method_view_issue):
        """Verifies FastOpenAPI routes have request.blueprint == None."""
        captured = {}

        @app_with_login_manager.route("/console/api/test")
        def test_route():
            from flask import request

            captured["blueprint"] = request.blueprint
            return {"ok": True}

        response = app_with_login_manager.test_client().get("/console/api/test")
        assert response.status_code == 200
        assert captured["blueprint"] is None

    def test_unauthorized_raises_exception_not_response(self, app_with_login_manager, fix_method_view_issue):
        """Verifies unauthorized handler raises Unauthorized (serializable by orjson)."""

        @app_with_login_manager.route("/console/api/protected")
        def protected():
            raise Unauthorized("Unauthorized.")

        response = app_with_login_manager.test_client().get("/console/api/protected")
        assert response.status_code == 401
        assert b"TypeError" not in response.data  # No serialization error


# ------------------------------------------------------------------------------
# OpenAPI Schema Compliance Tests
# ------------------------------------------------------------------------------


class TestOpenAPISchemaCompliance:
    """Tests for route registration and HTTP method handling."""

    def test_routes_registered_correctly(self, app, mock_feature_module_env):
        """Verifies routes are registered with correct paths."""
        ext_fastopenapi.init_app(app)
        rules = {rule.rule for rule in app.url_map.iter_rules()}

        assert "/console/api/features" in rules
        assert "/console/api/system-features" in rules

    def test_routes_only_accept_get(self, app, mock_feature_module_env):
        """Verifies feature endpoints reject non-GET methods with 405."""
        with patch("controllers.console.feature.FeatureService.get_features", return_value=FeatureModel()):
            ext_fastopenapi.init_app(app)
            client = app.test_client()

            assert client.get("/console/api/features").status_code == 200
            assert client.post("/console/api/features").status_code == 405

    def test_system_features_handles_both_auth_states(self, app, mock_feature_module_env):
        """Verifies /system-features handles authenticated state correctly."""
        feature_module = mock_feature_module_env
        mock_model = SystemFeatureModel(enable_marketplace=True)

        with patch("controllers.console.feature.FeatureService.get_system_features", return_value=mock_model) as svc:
            type(feature_module.current_user).is_authenticated = PropertyMock(return_value=True)
            ext_fastopenapi.init_app(app)
            response = app.test_client().get("/console/api/system-features")

            assert response.status_code == 200
            svc.assert_called_with(is_authenticated=True)
