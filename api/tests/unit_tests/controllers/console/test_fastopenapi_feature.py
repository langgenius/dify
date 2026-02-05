import builtins
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.exceptions import Unauthorized

from extensions import ext_fastopenapi
from services.feature_service import SystemFeatureModel

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
    data = response.get_json()
    assert data["enable_email_password_login"] is True
    assert data["is_allow_register"] is False
    assert data["enable_marketplace"] is False


def test_console_system_features_fastopenapi_handles_unauthorized(app: Flask):
    ext_fastopenapi.init_app(app)

    mock_features = SystemFeatureModel()
    mock_user = MagicMock()
    type(mock_user).is_authenticated = PropertyMock(side_effect=Unauthorized())

    with (
        patch("controllers.console.feature.current_user", mock_user),
        patch(
            "controllers.console.feature.FeatureService.get_system_features", return_value=mock_features
        ) as mock_svc,
    ):
        client = app.test_client()
        response = client.get("/console/api/system-features")

    assert response.status_code == 200
    mock_svc.assert_called_once_with(is_authenticated=False)
