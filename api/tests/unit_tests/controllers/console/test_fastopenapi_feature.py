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


@pytest.fixture
def app():
    """
    Creates a Flask application instance configured for testing.
    """
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret"
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"

    # Initialize the database with the app
    db.init_app(app)

    return app


@pytest.fixture(autouse=True)
def fix_method_view_issue(monkeypatch):
    """
    Automatic fixture to patch 'builtins.MethodView'.

    Why this is needed:
    The official legacy codebase contains a global patch in its initialization logic:
        if not hasattr(builtins, "MethodView"):
             builtins.MethodView = MethodView

    Some dependencies (like ext_fastopenapi or older Flask extensions) might implicitly
    rely on 'MethodView' being available in the global builtins namespace.

    Refactoring Note:
    While patching builtins is generally discouraged due to global side effects,
    this fixture reproduces the production environment's state to ensure tests are realistic.
    We use 'monkeypatch' to ensure that this change is undone after the test finishes,
    keeping other tests isolated.
    """
    if not hasattr(builtins, "MethodView"):
        # 'raising=False' allows us to set an attribute that doesn't exist yet
        monkeypatch.setattr(builtins, "MethodView", MethodView, raising=False)


# ------------------------------------------------------------------------------
# Helper Functions for Fixture Complexity Reduction
# ------------------------------------------------------------------------------


def _create_isolated_router():
    """
    Creates a fresh, isolated router instance to prevent route pollution.
    """
    import controllers.fastopenapi

    # Dynamically get the class type (e.g., FlaskRouter) to avoid hardcoding dependencies
    RouterClass = type(controllers.fastopenapi.console_router)
    return RouterClass()


@contextlib.contextmanager
def _patch_auth_and_router(temp_router):
    """
    Context manager that applies all necessary patches for:
    1. The console_router (redirecting to our isolated temp_router)
    2. Authentication decorators (disabling them with no-ops)
    3. User/Account loaders (mocking authenticated state)
    """

    def noop(f):
        return f

    # We patch the SOURCE of the decorators/functions, not the destination module.
    # This ensures that when 'controllers.console.feature' imports them, it gets the mocks.
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
        # Explicitly reload ext_fastopenapi to ensure it uses the patched console_router
        import extensions.ext_fastopenapi

        importlib.reload(extensions.ext_fastopenapi)

        yield


def _force_reload_module(target_module: str, alias_module: str):
    """
    Forces a reload of the specified module and handles sys.modules aliasing.

    Why reload?
    Python decorators (like @route, @login_required) run at IMPORT time.
    To apply our patches (mocks/no-ops) to these decorators, we must re-import
    the module while the patches are active.

    Why alias?
    If 'ext_fastopenapi' imports the controller as 'api.controllers...', but we import
    it as 'controllers...', Python treats them as two separate modules. This causes:
    1. Double execution of decorators (registering routes twice -> AssertionError).
    2. Type mismatch errors (Class A from module X is not Class A from module Y).

    This function ensures both names point to the SAME loaded module instance.
    """
    # 1. Clean existing entries to force re-import
    if target_module in sys.modules:
        del sys.modules[target_module]
    if alias_module in sys.modules:
        del sys.modules[alias_module]

    # 2. Import the module (triggering decorators with active patches)
    module = importlib.import_module(target_module)

    # 3. Alias the module in sys.modules to prevent double loading
    sys.modules[alias_module] = sys.modules[target_module]

    return module


def _cleanup_modules(target_module: str, alias_module: str):
    """
    Removes the module and its alias from sys.modules to prevent side effects
    on other tests.
    """
    if target_module in sys.modules:
        del sys.modules[target_module]
    if alias_module in sys.modules:
        del sys.modules[alias_module]


@pytest.fixture
def mock_feature_module_env():
    """
    Sets up a mocked environment for the feature module.

    This fixture orchestrates:
    1. Creating an isolated router.
    2. Patching authentication and global dependencies.
    3. Reloading the controller module to apply patches to decorators.
    4. cleaning up sys.modules afterwards.
    """
    target_module = "controllers.console.feature"
    alias_module = "api.controllers.console.feature"

    # 1. Prepare isolated router
    temp_router = _create_isolated_router()

    # 2. Apply patches
    try:
        with _patch_auth_and_router(temp_router):
            # 3. Reload module to register routes on the temp_router
            feature_module = _force_reload_module(target_module, alias_module)

            yield feature_module

    finally:
        # 4. Teardown: Clean up sys.modules
        _cleanup_modules(target_module, alias_module)


# ------------------------------------------------------------------------------
# Test Cases
# ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("url", "service_mock_path", "mock_model_instance"),
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
def test_console_features_success(app, mock_feature_module_env, url, service_mock_path, mock_model_instance):
    """
    Tests that the feature APIs return a 200 OK status and correct JSON structure.
    """
    # Patch the service layer to return our mock model instance
    with patch(service_mock_path, return_value=mock_model_instance):
        # Initialize the API extension
        ext_fastopenapi.init_app(app)

        client = app.test_client()
        response = client.get(url)

    # Assertions
    assert response.status_code == 200, f"Request failed with status {response.status_code}: {response.text}"

    # Verify the JSON response matches the Pydantic model dump (flat format, not wrapped)
    expected_data = mock_model_instance.model_dump(mode="json")
    assert response.get_json() == expected_data


@pytest.mark.parametrize(
    ("url", "service_mock_path"),
    [
        ("/console/api/features", "controllers.console.feature.FeatureService.get_features"),
        ("/console/api/system-features", "controllers.console.feature.FeatureService.get_system_features"),
    ],
)
def test_console_features_service_error(app, mock_feature_module_env, url, service_mock_path):
    """
    Tests how the application handles Service layer errors.

    Note: When an exception occurs in the view, it is typically caught by the framework
    (Flask or the OpenAPI wrapper) and converted to a 500 error response.
    This test verifies that the application returns a 500 status code.
    """
    # Simulate a service failure
    with patch(service_mock_path, side_effect=ValueError("Service Failure")):
        ext_fastopenapi.init_app(app)
        client = app.test_client()

        # When an exception occurs in the view, it is typically caught by the framework
        # (Flask or the OpenAPI wrapper) and converted to a 500 error response.
        response = client.get(url)

        assert response.status_code == 500
        # Check if the error details are exposed in the response (depends on error handler config)
        # We accept either generic 500 or the specific error message
        assert "Service Failure" in response.text or "Internal Server Error" in response.text


def test_system_features_unauthenticated(app, mock_feature_module_env):
    """
    Tests that /console/api/system-features endpoint works without authentication.

    This test verifies the try-except block in get_system_features that handles
    unauthenticated requests by passing is_authenticated=False to the service layer.
    """
    feature_module = mock_feature_module_env

    # Override the behavior of the current_user mock
    # The fixture patched 'libs.login.current_user', so 'controllers.console.feature.current_user'
    # refers to that same Mock object.
    mock_user = feature_module.current_user

    # Simulate property access raising Unauthorized
    # Note: We must reset side_effect if it was set, or set it here.
    # The fixture initialized it as MagicMock(is_authenticated=True).
    # We want type(mock_user).is_authenticated to raise Unauthorized.
    type(mock_user).is_authenticated = PropertyMock(side_effect=Unauthorized)

    # Patch the service layer for this specific test
    with patch("controllers.console.feature.FeatureService.get_system_features") as mock_service:
        # Setup mock service return value
        mock_model = SystemFeatureModel(enable_marketplace=True)
        mock_service.return_value = mock_model

        # Initialize app
        ext_fastopenapi.init_app(app)
        client = app.test_client()

        # Act
        response = client.get("/console/api/system-features")

        # Assert
        assert response.status_code == 200, f"Request failed: {response.text}"

        # Verify service was called with is_authenticated=False
        mock_service.assert_called_once_with(is_authenticated=False)

        # Verify response body (flat format, not wrapped)
        expected_data = mock_model.model_dump(mode="json")
        assert response.get_json() == expected_data


# ------------------------------------------------------------------------------
# FastOpenAPI Authentication Tests
# ------------------------------------------------------------------------------
# These tests verify that our fixes for FastOpenAPI routing work correctly:
# 1. load_user_from_request supports FastOpenAPI routes (no blueprint)
# 2. unauthorized_handler returns serializable response for FastOpenAPI routes
# 3. Response format is flat (not wrapped in {"features": ...})


class TestFastOpenAPIAuthenticationBehavior:
    """
    Tests for FastOpenAPI-specific authentication behavior.

    Unlike the tests above that mock authentication decorators,
    these tests verify the actual authentication flow works correctly
    for FastOpenAPI routes where request.blueprint is None.
    """

    @pytest.fixture
    def app_with_login_manager(self):
        """
        Creates a Flask app with login manager configured,
        simulating the production environment more closely.
        """
        from flask_login import LoginManager

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret"
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"

        # Initialize database
        db.init_app(app)

        # Initialize login manager with unauthorized handler that matches our fix
        login_manager = LoginManager()
        login_manager.init_app(app)

        @login_manager.unauthorized_handler
        def test_unauthorized_handler():
            """Simulates our fixed unauthorized_handler behavior."""
            from flask import request

            # For FastOpenAPI routes, raise exception (serializable by orjson)
            if request.blueprint is None and request.path.startswith("/console/api/"):
                raise Unauthorized("Unauthorized.")
            # For Blueprint routes, return Response (legacy behavior)
            import json

            from flask import Response

            return Response(
                json.dumps({"code": "unauthorized", "message": "Unauthorized."}),
                status=401,
                content_type="application/json",
            )

        return app

    def test_fastopenapi_route_has_no_blueprint(self, app_with_login_manager, fix_method_view_issue):
        """
        Verify that FastOpenAPI routes have request.blueprint == None.

        This is the core assumption our authentication fix relies on.
        """
        captured_blueprint = {}

        # Create a simple test route to capture request.blueprint
        @app_with_login_manager.route("/console/api/test-blueprint")
        def test_route():
            from flask import request

            captured_blueprint["value"] = request.blueprint
            return {"status": "ok"}

        client = app_with_login_manager.test_client()
        response = client.get("/console/api/test-blueprint")

        assert response.status_code == 200
        # FastOpenAPI routes registered directly on app have no blueprint
        assert captured_blueprint["value"] is None

    def test_unauthorized_response_is_serializable_json(self, app_with_login_manager, fix_method_view_issue):
        """
        Verify that unauthorized response for FastOpenAPI routes is valid JSON.

        When unauthorized_handler raises Unauthorized exception for FastOpenAPI routes,
        Flask/Werkzeug converts it to a proper HTTP 401 response that is serializable.
        """

        @app_with_login_manager.route("/console/api/protected")
        def protected_route():
            # Simulate login_required behavior when user is not authenticated
            raise Unauthorized("Unauthorized.")

        client = app_with_login_manager.test_client()
        response = client.get("/console/api/protected")

        assert response.status_code == 401
        # Response should be valid (either JSON or HTML error page, but not a serialization error)
        assert response.data is not None
        # Should not be a TypeError from orjson trying to serialize Response object
        assert b"TypeError" not in response.data

    def test_response_format_is_flat_not_wrapped(self, app, mock_feature_module_env):
        """
        Explicitly verify that response format is flat FeatureModel,
        not wrapped in {"features": {...}}.

        This ensures backward compatibility with frontend expectations.
        """
        mock_model = FeatureModel(can_replace_logo=True)

        with patch("controllers.console.feature.FeatureService.get_features", return_value=mock_model):
            ext_fastopenapi.init_app(app)
            client = app.test_client()
            response = client.get("/console/api/features")

        assert response.status_code == 200
        json_data = response.get_json()

        # Should NOT be wrapped format
        assert "features" not in json_data or not isinstance(json_data.get("features"), dict)

        # Should be flat format - top level keys are FeatureModel fields
        assert "can_replace_logo" in json_data


# ------------------------------------------------------------------------------
# Response Format and Content-Type Tests
# ------------------------------------------------------------------------------
# These tests verify OpenAPI v3 migration requirements for response handling


class TestResponseFormatValidation:
    """
    Tests for response format validation.

    Ensures FastOpenAPI produces correct Content-Type headers and JSON format
    that matches OpenAPI 3.0 specification requirements.
    """

    def test_response_content_type_is_json(self, app, mock_feature_module_env):
        """
        Verify response Content-Type is application/json.

        FastOpenAPI uses orjson for serialization, must produce correct Content-Type.
        """
        mock_model = FeatureModel(can_replace_logo=True)

        with patch("controllers.console.feature.FeatureService.get_features", return_value=mock_model):
            ext_fastopenapi.init_app(app)
            client = app.test_client()
            response = client.get("/console/api/features")

        assert response.status_code == 200
        # Content-Type should be JSON
        assert "application/json" in response.content_type

    def test_system_features_content_type_is_json(self, app, mock_feature_module_env):
        """
        Verify /system-features response Content-Type is application/json.
        """
        mock_model = SystemFeatureModel(enable_marketplace=True)

        with patch("controllers.console.feature.FeatureService.get_system_features", return_value=mock_model):
            ext_fastopenapi.init_app(app)
            client = app.test_client()
            response = client.get("/console/api/system-features")

        assert response.status_code == 200
        assert "application/json" in response.content_type

    def test_feature_model_all_fields_serialized(self, app, mock_feature_module_env):
        """
        Verify all FeatureModel fields are serialized in response.

        This ensures Pydantic model dump is complete for OpenAPI schema compliance.
        """
        mock_model = FeatureModel(
            can_replace_logo=True,
            model_load_balancing_enabled=True,
        )

        with patch("controllers.console.feature.FeatureService.get_features", return_value=mock_model):
            ext_fastopenapi.init_app(app)
            client = app.test_client()
            response = client.get("/console/api/features")

        assert response.status_code == 200
        json_data = response.get_json()

        # Verify key fields are present
        assert "can_replace_logo" in json_data
        assert json_data["can_replace_logo"] is True
        assert "model_load_balancing_enabled" in json_data
        assert json_data["model_load_balancing_enabled"] is True


# ------------------------------------------------------------------------------
# Authentication Behavior Tests with Realistic Mocking
# ------------------------------------------------------------------------------
# These tests use more realistic mocking to verify authentication behavior


class TestAuthenticationWithRealisticMocking:
    """
    Tests authentication behavior with more realistic mocking.

    Unlike tests that completely bypass decorators, these tests mock
    at the user/account level to verify decorator behavior.
    """

    @pytest.fixture
    def app_with_real_decorators(self, monkeypatch):
        """
        Creates a Flask app where decorators execute but dependencies are mocked.

        This provides a middle ground between:
        - Full integration tests (require database setup)
        - Tests that completely bypass decorators (don't test auth flow)
        """
        from flask import Flask
        from flask_login import LoginManager

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret"
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"

        # Initialize database
        db.init_app(app)

        # Initialize login manager
        login_manager = LoginManager()
        login_manager.init_app(app)

        # Mock request loader to return None (unauthenticated)
        @login_manager.request_loader
        def mock_load_user(request):
            # Check for test auth header
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer test-valid-token"):
                # Return a mock user
                mock_user = MagicMock()
                mock_user.is_authenticated = True
                mock_user.current_tenant_id = "test-tenant-id"
                return mock_user
            return None

        @login_manager.unauthorized_handler
        def handle_unauthorized():
            """Simulates production unauthorized_handler for FastOpenAPI routes."""
            from flask import request

            if request.blueprint is None and request.path.startswith("/console/api/"):
                raise Unauthorized("Unauthorized.")
            import json

            from flask import Response

            return Response(
                json.dumps({"code": "unauthorized", "message": "Unauthorized."}),
                status=401,
                content_type="application/json",
            )

        return app

    def test_features_endpoint_requires_authentication_concept(self, app_with_real_decorators, fix_method_view_issue):
        """
        Conceptual test: verify that a protected route would return 401 without auth.

        Note: This test creates a simple protected route to verify the auth flow,
        since the actual feature.py module loading is complex.
        """
        from flask_login import login_required as flask_login_required

        @app_with_real_decorators.route("/console/api/test-protected")
        @flask_login_required
        def protected_test_route():
            return {"status": "authenticated"}

        client = app_with_real_decorators.test_client()

        # Without authentication - should return 401
        response = client.get("/console/api/test-protected")
        assert response.status_code == 401

        # With valid test token - should return 200
        response_with_auth = client.get(
            "/console/api/test-protected", headers={"Authorization": "Bearer test-valid-token"}
        )
        assert response_with_auth.status_code == 200

    def test_system_features_no_auth_decorator_concept(self, app_with_real_decorators, fix_method_view_issue):
        """
        Conceptual test: verify that an unprotected route works without auth.

        This mirrors /system-features behavior which has no @login_required.
        """

        @app_with_real_decorators.route("/console/api/test-public")
        def public_test_route():
            return {"status": "public"}

        client = app_with_real_decorators.test_client()

        # Without authentication - should still work
        response = client.get("/console/api/test-public")
        assert response.status_code == 200
        assert response.get_json()["status"] == "public"


# ------------------------------------------------------------------------------
# OpenAPI Schema Compliance Tests
# ------------------------------------------------------------------------------
# These tests verify the generated OpenAPI schema meets requirements


class TestOpenAPISchemaCompliance:
    """
    Tests for OpenAPI 3.0 schema compliance.

    Verifies that FastOpenAPI generates correct schema for endpoints.
    """

    def test_fastopenapi_registers_routes_correctly(self, app, mock_feature_module_env):
        """
        Verify that FastOpenAPI registers routes with correct paths.
        """
        ext_fastopenapi.init_app(app)

        # Check that routes are registered
        rules = {rule.rule for rule in app.url_map.iter_rules()}

        # Feature endpoints should be registered
        assert "/console/api/features" in rules
        assert "/console/api/system-features" in rules

    def test_fastopenapi_routes_use_get_method(self, app, mock_feature_module_env):
        """
        Verify that feature endpoints only accept GET method.
        """
        mock_model = FeatureModel(can_replace_logo=True)

        with patch("controllers.console.feature.FeatureService.get_features", return_value=mock_model):
            ext_fastopenapi.init_app(app)
            client = app.test_client()

            # GET should work
            response_get = client.get("/console/api/features")
            assert response_get.status_code == 200

            # POST should return 405 Method Not Allowed
            response_post = client.post("/console/api/features")
            assert response_post.status_code == 405

    def test_system_features_handles_both_auth_states(self, app, mock_feature_module_env):
        """
        Verify /system-features correctly handles both authenticated and unauthenticated states.

        This is a critical test for the is_authenticated try-catch logic.
        """
        feature_module = mock_feature_module_env

        # Test 1: When user is authenticated
        with patch("controllers.console.feature.FeatureService.get_system_features") as mock_service:
            mock_model = SystemFeatureModel(enable_marketplace=True)
            mock_service.return_value = mock_model

            # Reset mock to authenticated state
            type(feature_module.current_user).is_authenticated = PropertyMock(return_value=True)

            ext_fastopenapi.init_app(app)
            client = app.test_client()
            response = client.get("/console/api/system-features")

            assert response.status_code == 200
            # Service should be called with is_authenticated=True
            mock_service.assert_called_with(is_authenticated=True)
