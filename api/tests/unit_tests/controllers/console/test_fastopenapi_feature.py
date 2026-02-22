import builtins
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.exceptions import Unauthorized

from extensions import ext_fastopenapi
from services.feature_service import FeatureModel, SystemFeatureModel

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def test_console_system_features_fastopenapi_returns_defaults(app: Flask):
    ext_fastopenapi.init_app(app)

    mock_features = SystemFeatureModel()
    mock_user = MagicMock()
    mock_user.is_authenticated = False

    with (
        patch("controllers.console.feature.current_user", mock_user),
        patch("controllers.console.feature.FeatureService.get_system_features", return_value=mock_features),
    ):
        client = app.test_client()
        response = client.get("/console/api/system-features")

    assert response.status_code == 200
    assert response.get_json() == mock_features.model_dump()


def test_console_system_features_fastopenapi_handles_unauthorized(app: Flask):
    ext_fastopenapi.init_app(app)

    mock_features = SystemFeatureModel()
    mock_user = MagicMock()
    type(mock_user).is_authenticated = PropertyMock(side_effect=Unauthorized())

    with (
        patch("controllers.console.feature.current_user", mock_user),
        patch("controllers.console.feature.FeatureService.get_system_features", return_value=mock_features) as mock_svc,
    ):
        client = app.test_client()
        response = client.get("/console/api/system-features")

    assert response.status_code == 200
    mock_svc.assert_called_once_with(is_authenticated=False)


def test_console_features_fastopenapi_returns_tenant_features(app: Flask):
    ext_fastopenapi.init_app(app)

    mock_features = FeatureModel()
    mock_tenant_id = "test-tenant-id"
    mock_account = MagicMock()
    mock_account.is_authenticated = True
    mock_account.status = "active"
    mock_account.current_tenant_id = mock_tenant_id
    mock_account.id = "test-user-id"

    with (
        # Bypass setup_required (only checks SELF_HOSTED edition)
        patch("controllers.console.wraps.dify_config.EDITION", "CLOUD"),
        # Bypass login_required auth check
        patch("libs.login.dify_config.LOGIN_DISABLED", True),
        # Bypass CSRF token validation
        patch("libs.login.check_csrf_token"),
        # Provide a mock user for current_user proxy
        patch("libs.login._get_user", return_value=mock_account),
        # Bypass account_initialization_required and cloud_utm_record
        patch(
            "controllers.console.wraps.current_account_with_tenant",
            return_value=(mock_account, mock_tenant_id),
        ),
        # Mock FeatureService.get_features in wraps module (used by cloud_utm_record)
        patch("controllers.console.wraps.FeatureService.get_features", return_value=mock_features),
        # Mock the actual endpoint call
        patch(
            "controllers.console.feature.current_account_with_tenant",
            return_value=(mock_account, mock_tenant_id),
        ),
        patch("controllers.console.feature.FeatureService.get_features", return_value=mock_features) as mock_svc,
    ):
        client = app.test_client()
        response = client.get("/console/api/features")

    assert response.status_code == 200
    assert response.get_json() == mock_features.model_dump()
    mock_svc.assert_called_once_with(mock_tenant_id)
