"""SSO-branch device-flow endpoints under /openapi/v1/oauth/device/."""

import builtins
from dataclasses import dataclass

import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.exceptions import ServiceUnavailable

from controllers.openapi import bp as openapi_bp
from controllers.openapi.oauth_device_sso import (
    _raise_http_error,
    approval_context,
    approve_external,
    sso_complete,
    sso_initiate,
)
from services.oauth_device_contracts import ApprovalOutcomeUnknownError, DeviceSSOCompletion

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


def test_unknown_external_approval_outcome_is_retryable() -> None:
    with pytest.raises(ServiceUnavailable, match="approval_outcome_unknown"):
        _raise_http_error(ApprovalOutcomeUnknownError())


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


class _CompletionService:
    def complete_sso(self, _context, *, inbound_error, inbound_user_code, assertion):
        _ = assertion
        if inbound_error:
            return DeviceSSOCompletion(error_code=inbound_error, user_code=inbound_user_code)
        return DeviceSSOCompletion(error_code="sso_failed")


@dataclass(frozen=True, slots=True)
class _FeatureQueries:
    valid_enterprise_license: bool

    def has_valid_enterprise_license(self) -> bool:
        return self.valid_enterprise_license


@dataclass(frozen=True, slots=True)
class _ApplicationServices:
    oauth_device: _CompletionService
    feature_queries: _FeatureQueries


def _install_application_services(monkeypatch: pytest.MonkeyPatch, *, valid_enterprise_license: bool) -> None:
    from controllers.openapi import flask_admission, oauth_device_sso

    services = _ApplicationServices(
        oauth_device=_CompletionService(),
        feature_queries=_FeatureQueries(valid_enterprise_license=valid_enterprise_license),
    )
    monkeypatch.setattr(flask_admission, "application_services", lambda: services)
    monkeypatch.setattr(oauth_device_sso, "application_services", lambda: services)


@pytest.fixture
def admitted_sso(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_application_services(monkeypatch, valid_enterprise_license=True)


def test_sso_complete_relays_inbound_sso_error(openapi_app, admitted_sso):
    _ = admitted_sso
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


def test_sso_complete_missing_assertion_redirects_generic(openapi_app, admitted_sso):
    _ = admitted_sso
    client = openapi_app.test_client()
    resp = client.get("/openapi/v1/oauth/device/sso-complete", follow_redirects=False)
    assert resp.status_code == 302
    assert "sso_error=sso_failed" in resp.headers["Location"]


def test_sso_admission_rejects_inactive_license(openapi_app, monkeypatch: pytest.MonkeyPatch):
    _install_application_services(monkeypatch, valid_enterprise_license=False)

    response = openapi_app.test_client().get("/openapi/v1/oauth/device/sso-complete")

    assert response.status_code == 404
