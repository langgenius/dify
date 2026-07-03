from __future__ import annotations

from unittest.mock import MagicMock, patch
from urllib.parse import urlparse

import pytest
from flask import Flask

from controllers.openapi import bp as openapi_bp


@pytest.fixture
def app() -> Flask:
    a = Flask(__name__)
    a.config["TESTING"] = True
    a.register_blueprint(openapi_bp)
    return a


def _ee_features():
    from services.feature_service import LicenseStatus

    m = MagicMock()
    m.license.status = LicenseStatus.ACTIVE
    return m


@patch("controllers.openapi.oauth_device_sso.EnterpriseService")
@patch("controllers.openapi.oauth_device_sso.jws")
@patch("controllers.openapi.oauth_device_sso.DeviceFlowRedis")
@patch("controllers.openapi.oauth_device_sso.dify_config")
@patch("libs.device_flow_security.FeatureService.get_system_features")
@patch("libs.rate_limit.RateLimiter.is_rate_limited", new=MagicMock(return_value=False))
@patch("libs.rate_limit.RateLimiter.increment_rate_limit", new=MagicMock())
def test_idp_callback_url_uses_console_api_url_not_host_header(ee_feat, cfg, redis_cls, jws_mod, ent, app: Flask):
    ee_feat.return_value = _ee_features()
    cfg.CONSOLE_API_URL = "https://api.dify.example"
    state = MagicMock()
    from services.oauth_device_flow import DeviceFlowStatus

    state.status = DeviceFlowStatus.PENDING
    redis_cls.return_value.load_by_user_code.return_value = ("dc_x", state)
    jws_mod.KeySet.from_shared_secret.return_value = MagicMock()
    jws_mod.sign.return_value = "signed-state"
    jws_mod.AUD_STATE_ENVELOPE = "aud"
    ent.initiate_device_flow_sso.return_value = {"url": "https://idp.example/auth"}

    client = app.test_client()
    client.get(
        "/openapi/v1/oauth/device/sso-initiate?user_code=ABCD-EFGH",
        headers={"Host": "evil.com"},
    )

    args, kwargs = jws_mod.sign.call_args
    signed_payload = args[1] if len(args) > 1 else kwargs["payload"]
    callback_url = urlparse(signed_payload["idp_callback_url"])
    assert callback_url.scheme == "https"
    assert callback_url.hostname == "api.dify.example"
    assert "evil.com" not in signed_payload["idp_callback_url"]


@patch("controllers.openapi.oauth_device_sso.DeviceFlowRedis")
@patch("controllers.openapi.oauth_device_sso.dify_config")
@patch("libs.device_flow_security.FeatureService.get_system_features")
@patch("libs.rate_limit.RateLimiter.is_rate_limited", new=MagicMock(return_value=False))
@patch("libs.rate_limit.RateLimiter.increment_rate_limit", new=MagicMock())
def test_sso_initiate_fails_closed_when_console_api_url_unset(ee_feat, cfg, redis_cls, app: Flask):
    ee_feat.return_value = _ee_features()
    cfg.CONSOLE_API_URL = ""
    from services.oauth_device_flow import DeviceFlowStatus

    state = MagicMock()
    state.status = DeviceFlowStatus.PENDING
    redis_cls.return_value.load_by_user_code.return_value = ("dc_x", state)

    client = app.test_client()
    resp = client.get("/openapi/v1/oauth/device/sso-initiate?user_code=ABCD-EFGH")
    assert resp.status_code == 502
