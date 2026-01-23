import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from extensions import ext_fastopenapi

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def test_console_files_fastopenapi_get_upload_config(app: Flask, monkeypatch: pytest.MonkeyPatch):
    ext_fastopenapi.init_app(app)

    monkeypatch.setattr("controllers.console.files.setup_required", lambda f: f)
    monkeypatch.setattr("controllers.console.files.login_required", lambda f: f)
    monkeypatch.setattr("controllers.console.files.account_initialization_required", lambda f: f)

    client = app.test_client()
    response = client.get("/console/api/files/upload")

    assert response.status_code == 200
    data = response.get_json()
    assert "file_size_limit" in data
    assert "batch_count_limit" in data


def test_console_files_fastopenapi_get_support_types(app: Flask, monkeypatch: pytest.MonkeyPatch):
    ext_fastopenapi.init_app(app)

    monkeypatch.setattr("controllers.console.files.setup_required", lambda f: f)
    monkeypatch.setattr("controllers.console.files.login_required", lambda f: f)
    monkeypatch.setattr("controllers.console.files.account_initialization_required", lambda f: f)

    client = app.test_client()
    response = client.get("/console/api/files/support-type")

    assert response.status_code == 200
    data = response.get_json()
    assert "allowed_extensions" in data
