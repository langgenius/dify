from __future__ import annotations

from unittest.mock import MagicMock, patch

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


@patch("controllers.openapi.oauth_device_sso.jws")
@patch("libs.device_flow_security.FeatureService.get_system_features")
def test_sso_complete_rejects_assertion_missing_email(ee_feat, jws_mod, app: Flask):
    ee_feat.return_value = _ee_features()
    jws_mod.verify.return_value = {"issuer": "https://idp.example", "user_code": "ABCD-EFGH", "nonce": "n"}
    jws_mod.AUD_EXT_SUBJECT_ASSERTION = "aud"
    jws_mod.KeySet.from_shared_secret.return_value = object()
    jws_mod.VerifyError = Exception

    client = app.test_client()
    resp = client.get("/openapi/v1/oauth/device/sso-complete?sso_assertion=blob", follow_redirects=False)
    assert resp.status_code == 302, resp.data
    assert "sso_error=sso_failed" in resp.headers["Location"]


@patch("controllers.openapi.oauth_device_sso.jws")
@patch("libs.device_flow_security.FeatureService.get_system_features")
def test_sso_complete_rejects_assertion_empty_issuer(ee_feat, jws_mod, app: Flask):
    ee_feat.return_value = _ee_features()
    jws_mod.verify.return_value = {"email": "x@y.com", "issuer": "", "user_code": "ABCD-EFGH", "nonce": "n"}
    jws_mod.AUD_EXT_SUBJECT_ASSERTION = "aud"
    jws_mod.KeySet.from_shared_secret.return_value = object()
    jws_mod.VerifyError = Exception

    client = app.test_client()
    resp = client.get("/openapi/v1/oauth/device/sso-complete?sso_assertion=blob", follow_redirects=False)
    assert resp.status_code == 302
    assert "sso_error=sso_failed" in resp.headers["Location"]


def test_verify_approval_grant_raises_on_missing_field():
    from libs import device_flow_security
    from libs import jws as jws_mod

    class _FakeKeyset:
        active_kid = "k"

        def lookup(self, kid):
            return b"secret"

    keyset = _FakeKeyset()
    incomplete = jws_mod.sign(
        keyset,
        payload={"subject_email": "x@y.com", "subject_issuer": "i", "user_code": "ABCD-EFGH", "nonce": "n"},
        aud=jws_mod.AUD_APPROVAL_GRANT,
        ttl_seconds=60,
    )
    with pytest.raises(jws_mod.VerifyError):
        device_flow_security.verify_approval_grant(keyset, incomplete)
