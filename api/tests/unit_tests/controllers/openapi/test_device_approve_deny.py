"""Phase D steps 13-14: device-flow approve/deny lifted to /openapi/v1.
Legacy /console/api/oauth/device/{approve,deny} stays mounted via
re-registration in console/auth/oauth_device.py.
"""
import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.console import bp as console_bp
from controllers.openapi import bp as openapi_bp
from controllers.openapi.oauth_device import DeviceApproveApi, DeviceDenyApi

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def dual_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(console_bp)
    app.register_blueprint(openapi_bp)
    return app


def _rule(app: Flask, path: str):
    return next(r for r in app.url_map.iter_rules() if r.rule == path)


def test_openapi_approve_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/approve" in rules


def test_legacy_console_approve_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/console/api/oauth/device/approve" in rules


def test_approve_paths_dispatch_to_same_class(dual_app: Flask):
    new = _rule(dual_app, "/openapi/v1/oauth/device/approve")
    legacy = _rule(dual_app, "/console/api/oauth/device/approve")
    assert dual_app.view_functions[new.endpoint].view_class is DeviceApproveApi
    assert dual_app.view_functions[legacy.endpoint].view_class is DeviceApproveApi


def test_openapi_deny_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/deny" in rules


def test_legacy_console_deny_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/console/api/oauth/device/deny" in rules


def test_deny_paths_dispatch_to_same_class(dual_app: Flask):
    new = _rule(dual_app, "/openapi/v1/oauth/device/deny")
    legacy = _rule(dual_app, "/console/api/oauth/device/deny")
    assert dual_app.view_functions[new.endpoint].view_class is DeviceDenyApi
    assert dual_app.view_functions[legacy.endpoint].view_class is DeviceDenyApi


def test_approve_and_deny_methods(dual_app: Flask):
    approve = _rule(dual_app, "/openapi/v1/oauth/device/approve")
    deny = _rule(dual_app, "/openapi/v1/oauth/device/deny")
    assert "POST" in approve.methods
    assert "POST" in deny.methods
