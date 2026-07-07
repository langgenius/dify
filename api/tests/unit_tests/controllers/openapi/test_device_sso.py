"""SSO-branch device-flow endpoints under /openapi/v1/oauth/device/."""

import builtins
from unittest.mock import MagicMock, patch

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


# ---------------------------------------------------------------------------
# _device_error_redirect helper
# ---------------------------------------------------------------------------


def test_device_error_redirect_builds_relative_location():
    from controllers.openapi import oauth_device_sso

    app = Flask(__name__)
    with app.test_request_context():
        resp = oauth_device_sso._device_error_redirect("sso_failed", "ABCD-1234")
    assert resp.status_code == 302
    loc = resp.headers["Location"]
    assert loc.startswith("/device?")
    assert "sso_error=sso_failed" in loc
    assert "user_code=ABCD-1234" in loc


def test_device_error_redirect_clamps_unknown_code():
    from controllers.openapi import oauth_device_sso

    app = Flask(__name__)
    with app.test_request_context():
        resp = oauth_device_sso._device_error_redirect("totally-bogus")
    assert "sso_error=sso_failed" in resp.headers["Location"]


def test_device_error_redirect_keeps_email_special_case():
    from controllers.openapi import oauth_device_sso

    app = Flask(__name__)
    with app.test_request_context():
        resp = oauth_device_sso._device_error_redirect("email_belongs_to_dify_account", "ABCD-1234")
    assert "sso_error=email_belongs_to_dify_account" in resp.headers["Location"]


def test_device_error_redirect_omits_empty_user_code():
    from controllers.openapi import oauth_device_sso

    app = Flask(__name__)
    with app.test_request_context():
        resp = oauth_device_sso._device_error_redirect("sso_failed")
    assert "user_code=" not in resp.headers["Location"]


def test_device_error_redirect_drops_malformed_user_code():
    from controllers.openapi import oauth_device_sso

    app = Flask(__name__)
    with app.test_request_context():
        resp = oauth_device_sso._device_error_redirect("sso_failed", "https://evil.example/")
    loc = resp.headers["Location"]
    assert loc.startswith("/device?")
    assert "user_code=" not in loc
    assert "evil" not in loc


# ---------------------------------------------------------------------------
# sso_complete redirect behaviour
# ---------------------------------------------------------------------------


def _ee_features():
    from services.feature_service import LicenseStatus

    m = MagicMock()
    m.license.status = LicenseStatus.ACTIVE
    return m


@patch("libs.device_flow_security.FeatureService.get_system_features")
def test_sso_complete_relays_inbound_sso_error(ee_feat, openapi_app):
    ee_feat.return_value = _ee_features()
    client = openapi_app.test_client()
    resp = client.get(
        "/openapi/v1/oauth/device/sso-complete?sso_error=sso_failed&user_code=ABCD-1234",
        follow_redirects=False,
    )
    assert resp.status_code == 302
    loc = resp.headers["Location"]
    assert "/device?" in loc
    assert "sso_error=sso_failed" in loc
    assert "user_code=ABCD-1234" in loc


@patch("libs.device_flow_security.FeatureService.get_system_features")
def test_sso_complete_missing_assertion_redirects_generic(ee_feat, openapi_app):
    ee_feat.return_value = _ee_features()
    client = openapi_app.test_client()
    resp = client.get("/openapi/v1/oauth/device/sso-complete", follow_redirects=False)
    assert resp.status_code == 302
    assert "sso_error=sso_failed" in resp.headers["Location"]
