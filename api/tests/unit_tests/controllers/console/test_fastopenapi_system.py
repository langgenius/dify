import builtins

import pytest
from flask.views import MethodView

from configs import dify_config
from dify_app import DifyApp
from extensions import ext_fastopenapi
from tests.unit_tests.config_override import config_overrides_context

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def app() -> DifyApp:
    app = DifyApp(__name__)
    app.config["TESTING"] = True
    return app


def test_console_ping_fastopenapi_returns_pong(app: DifyApp) -> None:
    ext_fastopenapi.init_app(app)

    response = app.test_client().get("/console/api/ping")

    assert response.status_code == 200
    assert response.get_json() == {"result": "pong"}


def test_console_version_fastopenapi_returns_current_version(app: DifyApp) -> None:
    ext_fastopenapi.init_app(app)

    with config_overrides_context(CHECK_UPDATE_URL=None):
        response = app.test_client().get("/console/api/version", query_string={"current_version": "0.0.0"})

    assert response.status_code == 200
    assert response.get_json() == {
        "version": dify_config.project.version,
        "release_notes": "",
    }
