import builtins
from unittest.mock import patch

import pytest
from flask import Flask
from flask.views import MethodView

from extensions import ext_fastopenapi
from services.feature_service import FeatureModel, SystemFeatureModel

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def test_console_features_fastopenapi_get(app: Flask, monkeypatch: pytest.MonkeyPatch):
    ext_fastopenapi.init_app(app)

    monkeypatch.setattr("controllers.console.feature.setup_required", lambda f: f)
    monkeypatch.setattr("controllers.console.feature.login_required", lambda f: f)
    monkeypatch.setattr("controllers.console.feature.account_initialization_required", lambda f: f)
    monkeypatch.setattr("controllers.console.feature.cloud_utm_record", lambda f: f)

    real_feature_model = FeatureModel()

    with (
        patch("controllers.console.feature.current_account_with_tenant", return_value=(object(), "tenant-id")),
        patch(
            "controllers.console.feature.FeatureService.get_features",
            return_value=real_feature_model,  # Mock return
        ),
    ):
        client = app.test_client()
        response = client.get("/console/api/features")

    if response.status_code == 500:
        print("Server Error Details:", response.get_data(as_text=True))

    assert response.status_code == 200

    response_json = response.get_json()

    assert "features" in response_json
    assert "billing" in response_json["features"]


def test_console_system_features_fastopenapi_get(app: Flask):
    ext_fastopenapi.init_app(app)

    with patch(
        "controllers.console.feature.FeatureService.get_system_features",
        return_value=SystemFeatureModel(),
    ):
        client = app.test_client()
        response = client.get("/console/api/system-features")

    assert response.status_code == 200
    assert response.get_json() == {"features": {"system": True}}
