"""GET /openapi/v1/oauth/device/sso-initiate — EE-only. Browser hits
this with a user_code; we sign an SSOState envelope and call the
Enterprise inner API to get the IdP authorize URL, then 302 to the IdP.

The handler is also registered on the legacy /v1/oauth/device/sso-initiate
path from controllers/oauth_device_sso.py until Phase F retires that mount.
"""
from __future__ import annotations

import logging
import secrets

from flask import redirect, request
from werkzeug.exceptions import BadGateway, BadRequest

from controllers.openapi import bp
from extensions.ext_redis import redis_client
from libs import jws
from libs.device_flow_security import (
    approval_grant_cleared_cookie_kwargs,
    enterprise_only,
)
from libs.rate_limit import LIMIT_SSO_INITIATE_PER_IP, rate_limit
from services.enterprise.enterprise_service import EnterpriseService
from services.oauth_device_flow import DeviceFlowRedis, DeviceFlowStatus

logger = logging.getLogger(__name__)


# Matches DEVICE_FLOW_TTL_SECONDS so the signed state can't outlive the
# device_code it references.
STATE_ENVELOPE_TTL_SECONDS = 15 * 60

# Canonical sso-complete path. IdP-side ACS callback URL must point here.
_SSO_COMPLETE_PATH = "/openapi/v1/oauth/device/sso-complete"


@bp.route("/oauth/device/sso-initiate", methods=["GET"])
@enterprise_only
@rate_limit(LIMIT_SSO_INITIATE_PER_IP)
def sso_initiate():
    user_code = (request.args.get("user_code") or "").strip().upper()
    if not user_code:
        raise BadRequest("user_code required")

    store = DeviceFlowRedis(redis_client)
    found = store.load_by_user_code(user_code)
    if found is None:
        raise BadRequest("invalid_user_code")
    _, state = found
    if state.status is not DeviceFlowStatus.PENDING:
        raise BadRequest("invalid_user_code")

    keyset = jws.KeySet.from_shared_secret()
    signed_state = jws.sign(
        keyset,
        payload={
            "redirect_url": "",
            "app_code": "",
            "intent": "device_flow",
            "user_code": user_code,
            "nonce": secrets.token_urlsafe(16),
            "return_to": "",
            "idp_callback_url": f"{request.host_url.rstrip('/')}{_SSO_COMPLETE_PATH}",
        },
        aud=jws.AUD_STATE_ENVELOPE,
        ttl_seconds=STATE_ENVELOPE_TTL_SECONDS,
    )

    try:
        reply = EnterpriseService.initiate_device_flow_sso(signed_state)
    except Exception as e:
        logger.warning("sso-initiate: enterprise call failed: %s", e)
        raise BadGateway("sso_initiate_failed") from e

    url = (reply or {}).get("url")
    if not url:
        raise BadGateway("sso_initiate_missing_url")

    # Clear stale approval-grant — defends against cross-tab/back-button mixing.
    resp = redirect(url, code=302)
    resp.set_cookie(**approval_grant_cleared_cookie_kwargs())
    return resp
