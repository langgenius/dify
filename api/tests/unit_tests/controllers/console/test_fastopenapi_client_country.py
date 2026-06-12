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


def test_console_client_country_returns_cloudflare_country(app: Flask):
    ext_fastopenapi.init_app(app)

    client = app.test_client()
    response = client.get("/console/api/client-country", headers={"CF-IPCountry": "cn"})

    assert response.status_code == 200
    assert response.get_json() == {"country": "CN"}


def test_console_client_country_returns_null_without_cloudflare_country(app: Flask):
    ext_fastopenapi.init_app(app)

    client = app.test_client()
    response = client.get("/console/api/client-country")

    assert response.status_code == 200
    assert response.get_json() == {"country": None}


def test_console_client_country_ignores_invalid_cloudflare_country(app: Flask):
    ext_fastopenapi.init_app(app)

    client = app.test_client()
    response = client.get("/console/api/client-country", headers={"CF-IPCountry": "China"})

    assert response.status_code == 200
    assert response.get_json() == {"country": None}
