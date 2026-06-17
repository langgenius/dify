import pytest
from flask import Flask

from controllers.console import bp as console_bp


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(console_bp)
    return app


def test_console_client_metadata_returns_cloudflare_geo(app: Flask):
    client = app.test_client()
    response = client.get("/console/api/client-metadata", headers={"CF-IPCountry": "cn"})

    assert response.status_code == 200
    assert response.get_json() == {"geo": {"country_code": "CN"}}


def test_console_client_metadata_returns_null_geo_without_cloudflare_header(app: Flask):
    client = app.test_client()
    response = client.get("/console/api/client-metadata")

    assert response.status_code == 200
    assert response.get_json() == {"geo": {"country_code": None}}


def test_console_client_metadata_ignores_invalid_cloudflare_geo(app: Flask):
    client = app.test_client()
    response = client.get("/console/api/client-metadata", headers={"CF-IPCountry": "China"})

    assert response.status_code == 200
    assert response.get_json() == {"geo": {"country_code": None}}
