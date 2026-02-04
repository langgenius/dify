import builtins
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.exceptions import Unauthorized

from extensions import ext_fastopenapi
from extensions.ext_database import db
from services.feature_service import FeatureModel, SystemFeatureModel

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def app() -> Flask:
    """Creates a Flask app configured for testing."""
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret"
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    db.init_app(app)
    return app


@pytest.fixture
def mock_auth():
    """Mocks authentication decorators and user context."""
    def noop(f):
        return f
    with (
        patch("controllers.console.wraps.setup_required", side_effect=noop),
        patch("libs.login.login_required", side_effect=noop),
        patch("controllers.console.wraps.account_initialization_required", side_effect=noop),
        patch("controllers.console.wraps.cloud_utm_record", side_effect=noop),
        patch("libs.login.current_account_with_tenant", return_value=(MagicMock(), "tenant-id")),
        patch("libs.login.current_user", MagicMock(is_authenticated=True)) as mock_user,
    ):
        yield mock_user


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
def test_feature_endpoints_return_200_with_flat_json(app, mock_auth, url, service_mock_path, mock_model):
    """Tests that feature endpoints return 200 with flat JSON format."""
    with patch(service_mock_path, return_value=mock_model):
        ext_fastopenapi.init_app(app)
        response = app.test_client().get(url)

    assert response.status_code == 200
    assert response.get_json() == mock_model.model_dump(mode="json")
    assert "application/json" in response.content_type


@pytest.mark.parametrize(
    ("url", "service_mock_path"),
    [
        ("/console/api/features", "controllers.console.feature.FeatureService.get_features"),
        ("/console/api/system-features", "controllers.console.feature.FeatureService.get_system_features"),
    ],
)
def test_feature_endpoints_return_500_on_service_error(app, mock_auth, url, service_mock_path):
    """Tests that service errors return 500."""
    with patch(service_mock_path, side_effect=ValueError("Service Failure")):
        ext_fastopenapi.init_app(app)
        response = app.test_client().get(url)

    assert response.status_code == 500


def test_system_features_handles_unauthenticated_users(app, mock_auth):
    """Tests /system-features passes is_authenticated=False when auth fails."""
    mock_user = mock_auth
    type(mock_user).is_authenticated = PropertyMock(side_effect=Unauthorized)
    mock_model = SystemFeatureModel(enable_marketplace=True)

    with patch("controllers.console.feature.FeatureService.get_system_features", return_value=mock_model) as svc:
        ext_fastopenapi.init_app(app)
        response = app.test_client().get("/console/api/system-features")

    assert response.status_code == 200
    svc.assert_called_once_with(is_authenticated=False)


def test_features_endpoint_rejects_post_method(app, mock_auth):
    """Tests that feature endpoints only accept GET."""
    with patch("controllers.console.feature.FeatureService.get_features", return_value=FeatureModel()):
        ext_fastopenapi.init_app(app)
        response = app.test_client().post("/console/api/features")

    assert response.status_code == 405


def test_routes_are_registered_correctly(app, mock_auth):
    """Tests that FastOpenAPI registers routes with correct paths."""
    ext_fastopenapi.init_app(app)
    rules = {rule.rule for rule in app.url_map.iter_rules()}

    assert "/console/api/features" in rules
    assert "/console/api/system-features" in rules


# ------------------------------------------------------------------------------
# FastOpenAPI Authentication Tests
# ------------------------------------------------------------------------------


@pytest.fixture
def app_with_login_manager():
    """Creates Flask app with login manager to test auth behavior."""
    from flask_login import LoginManager

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret"

    login_manager = LoginManager()
    login_manager.init_app(app)

    @login_manager.request_loader
    def load_user(request):
        if request.headers.get("Authorization") == "Bearer valid-token":
            user = MagicMock()
            user.is_authenticated = True
            return user
        return None

    @login_manager.unauthorized_handler
    def unauthorized():
        from flask import request
        # FastOpenAPI routes: raise exception (serializable)
        if request.blueprint is None and request.path.startswith("/console/api/"):
            raise Unauthorized("Unauthorized.")
        # Blueprint routes: return Response
        from flask import Response
        import json
        return Response(json.dumps({"code": "unauthorized"}), status=401, content_type="application/json")

    return app


def test_fastopenapi_route_has_no_blueprint(app_with_login_manager):
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


def test_protected_route_returns_401_without_auth(app_with_login_manager):
    """Tests that protected routes return 401 without authentication."""
    from flask_login import login_required

    @app_with_login_manager.route("/console/api/protected")
    @login_required
    def protected():
        return {"status": "ok"}

    client = app_with_login_manager.test_client()

    # Without auth
    assert client.get("/console/api/protected").status_code == 401

    # With valid token
    assert client.get("/console/api/protected", headers={"Authorization": "Bearer valid-token"}).status_code == 200
