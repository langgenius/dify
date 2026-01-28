import sys
import builtins
import pytest
import importlib
from unittest.mock import MagicMock, patch
from flask import Flask
from flask.views import MethodView

from extensions import ext_fastopenapi
from services.feature_service import FeatureModel, SystemFeatureModel


@pytest.fixture
def app():
    """
    Creates a Flask application instance configured for testing.
    """
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret"
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
def mock_auth_environment():
    """
    Sets up a mocked authentication environment.
    
    1. Removes the target controller from sys.modules to force a reload.
       This is necessary because decorators (like @login_required) run at import time.
    2. Patches all auth-related decorators with a no-op (no operation) lambda.
    3. Mocks the current user/account retrieval functions.
    4. PREVENTS ROUTE DUPLICATION by replacing the global console_router with a 
       temporary instance during the test.
    """
    def noop(f):
        return f

    target_module = "controllers.console.feature"

    # Import the router module to access the class and global variable
    import controllers.fastopenapi
    
    # Create a fresh router instance to isolate this test's route registrations.
    # We dynamically get the class type to avoid hardcoding dependencies.
    RouterClass = type(controllers.fastopenapi.console_router)
    temp_router = RouterClass()

    # Force reload of the module to ensure patches apply to decorators
    if target_module in sys.modules:
        del sys.modules[target_module]

    # Context manager for patching multiple dependencies
    # We patch 'controllers.fastopenapi.console_router' so that when the feature module
    # reloads, it registers routes to our temp_router instead of the global one.
    try:
        with patch("controllers.fastopenapi.console_router", temp_router), \
             patch(f"{target_module}.setup_required", side_effect=noop), \
             patch(f"{target_module}.login_required", side_effect=noop), \
             patch(f"{target_module}.account_initialization_required", side_effect=noop), \
             patch(f"{target_module}.cloud_utm_record", side_effect=noop), \
             patch(f"{target_module}.current_account_with_tenant", return_value=(MagicMock(), "tenant-id")), \
             patch(f"{target_module}.current_user", MagicMock(is_authenticated=True)):
            
            # Explicitly import the module to trigger the decorators with patches applied
            # This will register routes to 'temp_router' because of the patch above.
            import controllers.console.feature
            
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
    mock_auth_environment, 
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
    if response.status_code != 200:
        pytest.fail(f"Request failed with status {response.status_code}: {response.text}")
    assert response.status_code == 200
    
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
def test_console_features_service_error(app, mock_auth_environment, url, service_mock_path):
    """
    Tests how the application handles Service layer errors.
    
    Note: When app.config['TESTING'] is True, Flask propagates exceptions 
    instead of handling them generically (unless an error handler is registered).
    Therefore, we assert that the specific exception is raised.
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
