import builtins
from unittest.mock import patch

import pytest
from flask import Flask
from flask.views import MethodView

from extensions import ext_fastopenapi
from models.engine import db
from services.feature_service import FeatureModel, SystemFeatureModel

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


# 确保导入了 db
from models.engine import db


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    with app.app_context():
        try:
            import models  # noqa: F401
        except ImportError:
            pass

        db.create_all()

        yield app

        db.drop_all()


def test_console_features_fastopenapi_get(app: Flask, monkeypatch: pytest.MonkeyPatch):
    ext_fastopenapi.init_app(app)

    monkeypatch.setattr("controllers.console.feature.setup_required", lambda f: f)
    monkeypatch.setattr("controllers.console.feature.login_required", lambda f: f)
    monkeypatch.setattr("controllers.console.feature.account_initialization_required", lambda f: f)
    monkeypatch.setattr("controllers.console.feature.cloud_utm_record", lambda f: f)

    mock_data = FeatureModel().model_dump()

    with (
        patch("controllers.console.feature.current_account_with_tenant", return_value=(object(), "tenant-id")),
        patch(
            "controllers.console.feature.FeatureService.get_features",
            return_value=FeatureModel(),
        ),
    ):
        client = app.test_client()
        response = client.get("/console/api/features")

    if response.status_code == 500:
        print("Server Error Details:", response.get_data(as_text=True))

    assert response.status_code == 200

    json_resp = response.get_json()
    assert "features" in json_resp
    assert "billing" in json_resp["features"]


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
