"""POST /openapi/v1/oauth/device/code is the canonical RFC 8628 device
authorization endpoint.

Tests verify URL routing without invoking the handler — invoking would
require Redis, which the unit-test runtime does not initialise.
"""

import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from controllers.openapi.oauth_device import OAuthDeviceCodeApi

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
    assert "/openapi/v1/oauth/device/code" in rules


def test_route_dispatches_to_class(openapi_app: Flask):
    rule = next(r for r in openapi_app.url_map.iter_rules() if r.rule == "/openapi/v1/oauth/device/code")
    assert openapi_app.view_functions[rule.endpoint].view_class is OAuthDeviceCodeApi


def test_route_accepts_post(openapi_app: Flask):
    rule = next(r for r in openapi_app.url_map.iter_rules() if r.rule == "/openapi/v1/oauth/device/code")
    assert "POST" in rule.methods


def test_known_client_ids_default_includes_difyctl():
    from configs import dify_config

    assert "difyctl" in dify_config.OPENAPI_KNOWN_CLIENT_IDS
