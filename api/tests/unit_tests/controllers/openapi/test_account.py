"""Phase C steps 9–10: identity + self-revoke moved to /openapi/v1/account.
Legacy /v1/me + /v1/oauth/authorizations/self stay mounted via
re-registration in service_api/oauth.py.
"""
import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from controllers.openapi.account import AccountApi, AccountSessionsSelfApi
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


def _rule(app: Flask, path: str):
    return next(r for r in app.url_map.iter_rules() if r.rule == path)


def test_account_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/account" in rules


def test_legacy_me_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/v1/me" in rules


def test_account_and_me_dispatch_to_same_class(dual_app: Flask):
    new = _rule(dual_app, "/openapi/v1/account")
    legacy = _rule(dual_app, "/v1/me")
    assert dual_app.view_functions[new.endpoint].view_class is AccountApi
    assert dual_app.view_functions[legacy.endpoint].view_class is AccountApi


def test_account_sessions_self_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/account/sessions/self" in rules


def test_legacy_oauth_authorizations_self_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/v1/oauth/authorizations/self" in rules


def test_sessions_self_paths_dispatch_to_same_class(dual_app: Flask):
    new = _rule(dual_app, "/openapi/v1/account/sessions/self")
    legacy = _rule(dual_app, "/v1/oauth/authorizations/self")
    assert dual_app.view_functions[new.endpoint].view_class is AccountSessionsSelfApi
    assert dual_app.view_functions[legacy.endpoint].view_class is AccountSessionsSelfApi


def test_account_methods(dual_app: Flask):
    rule = _rule(dual_app, "/openapi/v1/account")
    assert "GET" in rule.methods


def test_sessions_self_methods(dual_app: Flask):
    rule = _rule(dual_app, "/openapi/v1/account/sessions/self")
    assert "DELETE" in rule.methods
