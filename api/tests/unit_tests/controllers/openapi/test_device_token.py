"""Phase B step 7: POST /openapi/v1/oauth/device/token mounted via the
canonical class. Legacy /v1/oauth/device/token re-registered. Both
paths must dispatch to the same class.
"""
import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from controllers.openapi.oauth_device import OAuthDeviceTokenApi
from controllers.service_api import bp as service_api_bp

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def dual_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(service_api_bp)
    app.register_blueprint(openapi_bp)
    return app


def test_openapi_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/token" in rules


def test_legacy_v1_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/v1/oauth/device/token" in rules


def test_both_paths_dispatch_to_same_class(dual_app: Flask):
    new = next(
        r for r in dual_app.url_map.iter_rules() if r.rule == "/openapi/v1/oauth/device/token"
    )
    legacy = next(
        r for r in dual_app.url_map.iter_rules() if r.rule == "/v1/oauth/device/token"
    )
    assert dual_app.view_functions[new.endpoint].view_class is OAuthDeviceTokenApi
    assert dual_app.view_functions[legacy.endpoint].view_class is OAuthDeviceTokenApi
