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
    ("url", "service_mock_path", "mock_model_instance", "json_key"),
    [
        (
            "/console/api/features",
            "controllers.console.feature.FeatureService.get_features",
            FeatureModel(can_replace_logo=True),
            "features",
        ),
        (
            "/console/api/system-features",
            "controllers.console.feature.FeatureService.get_system_features",
            SystemFeatureModel(enable_marketplace=True),
            "features",
        ),
    ],
)
def test_console_features_success(app, mock_feature_module_env, url, service_mock_path, mock_model_instance, json_key):
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

    # Verify the JSON response matches the Pydantic model dump
    expected_data = mock_model_instance.model_dump(mode="json")
    assert response.get_json() == {json_key: expected_data}


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

        # Verify response body
        expected_data = mock_model.model_dump(mode="json")
        assert response.get_json() == {"features": expected_data}
