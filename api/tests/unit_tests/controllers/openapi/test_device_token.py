"""POST /openapi/v1/oauth/device/token is the canonical poll endpoint."""

import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from controllers.openapi.oauth_device import OAuthDeviceTokenApi

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def openapi_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


def test_openapi_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/token" in rules


def test_route_dispatches_to_class(openapi_app: Flask):
    rule = next(r for r in openapi_app.url_map.iter_rules() if r.rule == "/openapi/v1/oauth/device/token")
    assert openapi_app.view_functions[rule.endpoint].view_class is OAuthDeviceTokenApi
