"""GET /openapi/v1/oauth/device/approval-context — EE-only. SPA reads
the device_approval_grant cookie claims (subject email/issuer, csrf
token, user_code, expiry). Idempotent — does not consume the nonce.

Also registered on the legacy /v1/oauth/device/approval-context path
from controllers/oauth_device_sso.py until Phase F retires that mount.
"""
from __future__ import annotations

import logging

from flask import jsonify, request
from werkzeug.exceptions import Unauthorized

from controllers.openapi import bp
from libs import jws
from libs.device_flow_security import (
    APPROVAL_GRANT_COOKIE_NAME,
    enterprise_only,
    verify_approval_grant,
)

logger = logging.getLogger(__name__)


@bp.route("/oauth/device/approval-context", methods=["GET"])
@enterprise_only
def approval_context():
    token = request.cookies.get(APPROVAL_GRANT_COOKIE_NAME)
    if not token:
        raise Unauthorized("no_session")

    keyset = jws.KeySet.from_shared_secret()
    try:
        claims = verify_approval_grant(keyset, token)
    except jws.VerifyError as e:
        logger.warning("approval-context: bad cookie: %s", e)
        raise Unauthorized("no_session") from e

    return jsonify({
        "subject_email": claims.subject_email,
        "subject_issuer": claims.subject_issuer,
        "user_code": claims.user_code,
        "csrf_token": claims.csrf_token,
        "expires_at": claims.expires_at.isoformat(),
    }), 200
