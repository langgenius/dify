"""GET /openapi/v1/oauth/device/sso-complete — EE-only ACS callback.
The IdP redirects here with a signed external-subject assertion;
we verify, mint the approval-grant cookie, and redirect to /device.

The handler is also registered on the legacy /v1/device/sso-complete
path from controllers/oauth_device_sso.py until Phase F retires that mount.
The legacy path lived under /v1/device/, not /v1/oauth/device/, so
existing IdP ACS configs need re-registration to the canonical path.
"""
from __future__ import annotations

import logging

from flask import redirect, request
from werkzeug.exceptions import BadRequest, Conflict

from controllers.openapi import bp
from extensions.ext_redis import redis_client
from libs import jws
from libs.device_flow_security import (
    approval_grant_cookie_kwargs,
    consume_sso_assertion_nonce,
    enterprise_only,
    mint_approval_grant,
)
from services.oauth_device_flow import DeviceFlowRedis, DeviceFlowStatus

logger = logging.getLogger(__name__)


@bp.route("/oauth/device/sso-complete", methods=["GET"])
@enterprise_only
def sso_complete():
    blob = request.args.get("sso_assertion")
    if not blob:
        raise BadRequest("sso_assertion required")

    keyset = jws.KeySet.from_shared_secret()

    try:
        claims = jws.verify(keyset, blob, expected_aud=jws.AUD_EXT_SUBJECT_ASSERTION)
    except jws.VerifyError as e:
        logger.warning("sso-complete: rejected assertion: %s", e)
        raise BadRequest("invalid_sso_assertion") from e

    if not consume_sso_assertion_nonce(redis_client, claims.get("nonce", "")):
        raise BadRequest("invalid_sso_assertion")

    user_code = (claims.get("user_code") or "").strip().upper()
    store = DeviceFlowRedis(redis_client)
    found = store.load_by_user_code(user_code)
    if found is None:
        raise Conflict("user_code_not_pending")
    _, state = found
    if state.status is not DeviceFlowStatus.PENDING:
        raise Conflict("user_code_not_pending")

    iss = request.host_url.rstrip("/")
    cookie_value, _ = mint_approval_grant(
        keyset=keyset,
        iss=iss,
        subject_email=claims["email"],
        subject_issuer=claims["issuer"],
        user_code=user_code,
    )

    resp = redirect("/device?sso_verified=1", code=302)
    resp.set_cookie(**approval_grant_cookie_kwargs(cookie_value))
    return resp
