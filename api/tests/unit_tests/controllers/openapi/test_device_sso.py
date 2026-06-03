"""SSO-branch device-flow endpoints under /openapi/v1/oauth/device/."""

import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from controllers.openapi.oauth_device_sso import (
    approval_context,
    approve_external,
    sso_complete,
    sso_initiate,
)

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


def test_sso_initiate_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/sso-initiate" in rules


def test_sso_complete_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/sso-complete" in rules


def test_approval_context_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/approval-context" in rules


def test_approve_external_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/approve-external" in rules


def test_sso_initiate_dispatches_to_function(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/oauth/device/sso-initiate")
    assert openapi_app.view_functions[rule.endpoint] is sso_initiate


def test_sso_complete_dispatches_to_function(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/oauth/device/sso-complete")
    assert openapi_app.view_functions[rule.endpoint] is sso_complete


def test_approval_context_dispatches_to_function(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/oauth/device/approval-context")
    assert openapi_app.view_functions[rule.endpoint] is approval_context


def test_approve_external_dispatches_to_function(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/oauth/device/approve-external")
    assert openapi_app.view_functions[rule.endpoint] is approve_external


def test_sso_complete_idp_callback_url_uses_canonical_path():
    """sso_initiate hardcodes the IdP callback URL — must point at the
    canonical /openapi/v1/ path so IdP-side ACS configuration matches.
    """
    from controllers.openapi import oauth_device_sso

    assert oauth_device_sso._SSO_COMPLETE_PATH == "/openapi/v1/oauth/device/sso-complete"


def test_device_url_uses_console_web_url_when_set(monkeypatch):
    """Redirect target must be absolute on the web origin so split-origin
    deployments (web :3000 / api :5001) land on the SPA, not the API host.
    """
    from configs import dify_config
    from controllers.openapi import oauth_device_sso

    monkeypatch.setattr(dify_config, "CONSOLE_WEB_URL", "https://web.example.com")
    assert (
        oauth_device_sso._device_url("?sso_verified=1")
        == "https://web.example.com/device?sso_verified=1"
    )


def test_device_url_strips_trailing_slash(monkeypatch):
    from configs import dify_config
    from controllers.openapi import oauth_device_sso

    monkeypatch.setattr(dify_config, "CONSOLE_WEB_URL", "https://web.example.com/")
    assert (
        oauth_device_sso._device_url("?sso_error=x")
        == "https://web.example.com/device?sso_error=x"
    )
