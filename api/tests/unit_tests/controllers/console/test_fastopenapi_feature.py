import sys
import builtins
import pytest
import importlib
from unittest.mock import MagicMock, patch, PropertyMock
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
    
    Some legacy code or dependencies (like ext_fastopenapi) might incorrectly 
    assume 'MethodView' is available globally in builtins.
    
    This fixture safely injects it if missing and cleans up after the test.
    """
    if not hasattr(builtins, "MethodView"):
        # 'raising=False' allows us to set an attribute that doesn't exist yet
        monkeypatch.setattr(builtins, "MethodView", MethodView, raising=False)


@pytest.fixture
def mock_feature_module_env():
    """
    Sets up a mocked environment for the feature module.
    
    1. Removes the target controller from sys.modules to force a reload.
       This is necessary because decorators (like @login_required) run at import time.
    2. Patches all auth-related decorators with a no-op (no operation) lambda.
    3. Mocks the current user/account retrieval functions (default: authenticated).
    4. PREVENTS ROUTE DUPLICATION by replacing the global console_router with a 
       temporary instance during the test.
    """
    def noop(f):
        return f

    target_module = "controllers.console.feature"
    # Potential alias if imported via full path (e.g. by ext_fastopenapi or other modules)
    alias_module = "api.controllers.console.feature"

    # Import the router module to access the class and global variable
    import controllers.fastopenapi
    
    # Create a fresh router instance to isolate this test's route registrations.
    # We dynamically get the class type to avoid hardcoding dependencies.
    RouterClass = type(controllers.fastopenapi.console_router)
    temp_router = RouterClass()

    # Force reload of the module to ensure patches apply to decorators
    if target_module in sys.modules:
        del sys.modules[target_module]
    if alias_module in sys.modules:
        del sys.modules[alias_module]

    # Context manager for patching multiple dependencies
    # We patch the SOURCE of the decorators/functions, not the destination module.
    # This ensures that when 'controllers.console.feature' imports them, it gets the mocks.
    try:
        with patch("controllers.fastopenapi.console_router", temp_router), \
             patch("controllers.console.wraps.setup_required", side_effect=noop), \
             patch("libs.login.login_required", side_effect=noop), \
             patch("controllers.console.wraps.account_initialization_required", side_effect=noop), \
             patch("controllers.console.wraps.cloud_utm_record", side_effect=noop), \
             patch("libs.login.current_account_with_tenant", return_value=(MagicMock(), "tenant-id")), \
             patch("libs.login.current_user", MagicMock(is_authenticated=True)):
            
            # Explicitly import the module to trigger the decorators with patches applied
            # This will register routes to 'temp_router' because of the patch above.
            import controllers.console.feature
            
            # PREVENT DOUBLE IMPORT:
            # If 'ext_fastopenapi' or other modules import this file as 'api.controllers.console.feature',
            # it would normally be treated as a different module and re-executed (registering routes twice).
            # By aliasing it in sys.modules, any subsequent import of the alias will return our 
            # already-loaded (and patched) module instance.
            sys.modules[alias_module] = sys.modules[target_module]
            
            # RELOAD EXTENSION: Ensure ext_fastopenapi also sees the patched console_router.
            # If ext_fastopenapi imported console_router at the top level, it holds a reference 
            # to the OLD (real) router. Reloading it forces it to re-import from 
            # controllers.fastopenapi, which is currently patched to return temp_router.
            importlib.reload(ext_fastopenapi)
            
            yield
    finally:
        # Restore the original state of ext_fastopenapi (pointing to the real router)
        # The patch context manager above has already exited, so controllers.fastopenapi.console_router
        # is back to the real router. Reloading the extension will make it pick up the real one again.
        # This is inside finally to ensure execution even if the test crashes.
        importlib.reload(ext_fastopenapi)

        # Clean up sys.modules again after test to avoid side effects
        if target_module in sys.modules:
            del sys.modules[target_module]
        if alias_module in sys.modules:
            del sys.modules[alias_module]


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
        "features"
    ),
    (
        "/console/api/system-features", 
        "controllers.console.feature.FeatureService.get_system_features", 
        SystemFeatureModel(enable_marketplace=True), 
        "features" 
    ),
])
def test_console_features_success(
    app, 
    mock_feature_module_env, 
    url, 
    service_mock_path, 
    mock_model_instance,
    json_key
):
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
    expected_data = mock_model_instance.model_dump(mode='json')
    assert response.get_json() == {json_key: expected_data}


@pytest.mark.parametrize(
    ("url", "service_mock_path"),
    [
    (
        "/console/api/features", 
        "controllers.console.feature.FeatureService.get_features"
    ),
    (
        "/console/api/system-features", 
        "controllers.console.feature.FeatureService.get_system_features"
    ),
])
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
    # Import the already patched module (from the fixture)
    import controllers.console.feature
    
    # Override the behavior of the current_user mock
    # The fixture patched 'libs.login.current_user', so 'controllers.console.feature.current_user' 
    # refers to that same Mock object.
    mock_user = controllers.console.feature.current_user
    
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
        expected_data = mock_model.model_dump(mode='json')
        assert response.get_json() == {"features": expected_data}
