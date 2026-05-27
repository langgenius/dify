"""Account-branch device-flow approve/deny under /openapi/v1."""

import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from controllers.openapi.oauth_device import DeviceApproveApi, DeviceDenyApi

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def openapi_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


def _rule(app: Flask, path: str):
    return next(r for r in app.url_map.iter_rules() if r.rule == path)


def test_approve_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/approve" in rules


def test_deny_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/deny" in rules


def test_approve_dispatches_to_class(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/oauth/device/approve")
    assert openapi_app.view_functions[rule.endpoint].view_class is DeviceApproveApi


def test_deny_dispatches_to_class(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/oauth/device/deny")
    assert openapi_app.view_functions[rule.endpoint].view_class is DeviceDenyApi


def test_approve_and_deny_methods(openapi_app: Flask):
    approve = _rule(openapi_app, "/openapi/v1/oauth/device/approve")
    deny = _rule(openapi_app, "/openapi/v1/oauth/device/deny")
    assert "POST" in approve.methods
    assert "POST" in deny.methods
