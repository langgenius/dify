"""Phase B step 6: POST /openapi/v1/oauth/device/code is the canonical
RFC 8628 device authorization endpoint. The legacy /v1/oauth/device/code
mount stays until Phase F; both paths must dispatch to the same class.

Tests verify URL routing and re-registration without invoking the
handler — invoking would require Redis, which the unit-test runtime
does not initialise.
"""
import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from controllers.openapi.oauth_device.code import OAuthDeviceCodeApi
from controllers.service_api import bp as service_api_bp

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def dual_app() -> Flask:
    """Both blueprints registered, mirroring production layout."""
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(service_api_bp)
    app.register_blueprint(openapi_bp)
    return app


def test_openapi_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/code" in rules


def test_legacy_v1_route_still_registered(dual_app: Flask):
    """service_api/oauth.py re-registers the lifted class on /v1/."""
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/v1/oauth/device/code" in rules


def test_both_paths_dispatch_to_same_class(dual_app: Flask):
    """Single source of truth — no duplicated handler logic."""
    new = next(
        r for r in dual_app.url_map.iter_rules() if r.rule == "/openapi/v1/oauth/device/code"
    )
    legacy = next(
        r for r in dual_app.url_map.iter_rules() if r.rule == "/v1/oauth/device/code"
    )

    new_view = dual_app.view_functions[new.endpoint]
    legacy_view = dual_app.view_functions[legacy.endpoint]
    # Flask-RESTX wraps Resource classes in a `view_class` attribute.
    assert new_view.view_class is OAuthDeviceCodeApi
    assert legacy_view.view_class is OAuthDeviceCodeApi


def test_route_accepts_post_and_options(dual_app: Flask):
    new = next(
        r for r in dual_app.url_map.iter_rules() if r.rule == "/openapi/v1/oauth/device/code"
    )
    legacy = next(
        r for r in dual_app.url_map.iter_rules() if r.rule == "/v1/oauth/device/code"
    )
    assert "POST" in new.methods
    assert "POST" in legacy.methods


def test_handler_class_imports_match():
    """service_api re-uses the openapi class, not a copy."""
    from controllers.service_api import oauth as service_api_oauth

    assert service_api_oauth.OAuthDeviceCodeApi is OAuthDeviceCodeApi


def test_known_client_ids_default_includes_difyctl():
    from configs import dify_config

    assert "difyctl" in dify_config.OPENAPI_KNOWN_CLIENT_IDS
