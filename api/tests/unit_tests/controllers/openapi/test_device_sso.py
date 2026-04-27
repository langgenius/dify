"""Phase D steps 15-16: SSO-branch device-flow endpoints lifted to
/openapi/v1/oauth/device/. Legacy /v1/* mounts stay via re-registration
in controllers/oauth_device_sso.py.
"""
import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.oauth_device_sso import bp as legacy_sso_bp
from controllers.openapi import bp as openapi_bp
from controllers.openapi.oauth_device.approval_context import approval_context
from controllers.openapi.oauth_device.approve_external import approve_external
from controllers.openapi.oauth_device.sso_complete import sso_complete
from controllers.openapi.oauth_device.sso_initiate import sso_initiate

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def dual_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(legacy_sso_bp)
    app.register_blueprint(openapi_bp)
    return app


def _rule(app: Flask, path: str):
    return next(r for r in app.url_map.iter_rules() if r.rule == path)


# Canonical /openapi/v1/* paths


def test_sso_initiate_canonical_path_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/sso-initiate" in rules


def test_sso_complete_canonical_path_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/sso-complete" in rules


def test_approval_context_canonical_path_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/approval-context" in rules


def test_approve_external_canonical_path_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/approve-external" in rules


# Legacy /v1/* paths


def test_sso_initiate_legacy_path_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/v1/oauth/device/sso-initiate" in rules


def test_sso_complete_legacy_path_registered(dual_app: Flask):
    """Legacy lived under /v1/device/, not /v1/oauth/device/."""
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/v1/device/sso-complete" in rules


def test_approval_context_legacy_path_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/v1/oauth/device/approval-context" in rules


def test_approve_external_legacy_path_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/v1/oauth/device/approve-external" in rules


# Both paths point at the same view function


def test_sso_initiate_dual_mount_same_function(dual_app: Flask):
    new_rule = _rule(dual_app, "/openapi/v1/oauth/device/sso-initiate")
    legacy_rule = _rule(dual_app, "/v1/oauth/device/sso-initiate")
    assert dual_app.view_functions[new_rule.endpoint] is sso_initiate
    assert dual_app.view_functions[legacy_rule.endpoint] is sso_initiate


def test_sso_complete_dual_mount_same_function(dual_app: Flask):
    new_rule = _rule(dual_app, "/openapi/v1/oauth/device/sso-complete")
    legacy_rule = _rule(dual_app, "/v1/device/sso-complete")
    assert dual_app.view_functions[new_rule.endpoint] is sso_complete
    assert dual_app.view_functions[legacy_rule.endpoint] is sso_complete


def test_approval_context_dual_mount_same_function(dual_app: Flask):
    new_rule = _rule(dual_app, "/openapi/v1/oauth/device/approval-context")
    legacy_rule = _rule(dual_app, "/v1/oauth/device/approval-context")
    assert dual_app.view_functions[new_rule.endpoint] is approval_context
    assert dual_app.view_functions[legacy_rule.endpoint] is approval_context


def test_approve_external_dual_mount_same_function(dual_app: Flask):
    new_rule = _rule(dual_app, "/openapi/v1/oauth/device/approve-external")
    legacy_rule = _rule(dual_app, "/v1/oauth/device/approve-external")
    assert dual_app.view_functions[new_rule.endpoint] is approve_external
    assert dual_app.view_functions[legacy_rule.endpoint] is approve_external


def test_sso_complete_idp_callback_url_uses_canonical_path():
    """sso_initiate hardcodes the IdP callback URL — must point to the
    canonical /openapi/v1/ path so IdPs are configured against the
    forward-looking ACS endpoint, not the legacy alias.
    """
    from controllers.openapi.oauth_device import sso_initiate as si

    assert si._SSO_COMPLETE_PATH == "/openapi/v1/oauth/device/sso-complete"
