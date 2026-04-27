"""POST /openapi/v1/oauth/device/approve-external — EE-only. User
clicks Approve in the SPA after federated SSO; cookie + CSRF gate
the request, then we mint a dfoe_ token and approve the device flow.

Also registered on the legacy /v1/oauth/device/approve-external path
from controllers/oauth_device_sso.py until Phase F retires that mount.
"""
from __future__ import annotations

import logging

from flask import jsonify, make_response, request
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, Unauthorized

from controllers.openapi import bp
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs import jws
from libs.device_flow_security import (
    APPROVAL_GRANT_COOKIE_NAME,
    ApprovalGrantClaims,
    approval_grant_cleared_cookie_kwargs,
    consume_approval_grant_nonce,
    enterprise_only,
    verify_approval_grant,
)
from libs.oauth_bearer import SubjectType
from libs.rate_limit import LIMIT_APPROVE_EXT_PER_EMAIL, enforce
from services.oauth_device_flow import (
    PREFIX_OAUTH_EXTERNAL_SSO,
    DeviceFlowRedis,
    DeviceFlowStatus,
    InvalidTransition,
    StateNotFound,
    mint_oauth_token,
    oauth_ttl_days,
)

logger = logging.getLogger(__name__)


@bp.route("/oauth/device/approve-external", methods=["POST"])
@enterprise_only
def approve_external():
    token = request.cookies.get(APPROVAL_GRANT_COOKIE_NAME)
    if not token:
        raise Unauthorized("invalid_session")

    keyset = jws.KeySet.from_shared_secret()
    try:
        claims: ApprovalGrantClaims = verify_approval_grant(keyset, token)
    except jws.VerifyError as e:
        logger.warning("approve-external: bad cookie: %s", e)
        raise Unauthorized("invalid_session") from e

    enforce(LIMIT_APPROVE_EXT_PER_EMAIL, key=f"subject:{claims.subject_email}")

    csrf_header = request.headers.get("X-CSRF-Token", "")
    if not csrf_header or csrf_header != claims.csrf_token:
        raise Forbidden("csrf_mismatch")

    data = request.get_json(silent=True) or {}
    body_user_code = (data.get("user_code") or "").strip().upper()
    if body_user_code != claims.user_code:
        raise BadRequest("user_code_mismatch")

    store = DeviceFlowRedis(redis_client)
    found = store.load_by_user_code(claims.user_code)
    if found is None:
        raise NotFound("user_code_not_pending")
    device_code, state = found
    if state.status is not DeviceFlowStatus.PENDING:
        raise Conflict("user_code_not_pending")

    if not consume_approval_grant_nonce(redis_client, claims.nonce):
        raise Unauthorized("session_already_consumed")

    ttl_days = oauth_ttl_days(tenant_id=None)
    mint = mint_oauth_token(
        db.session,
        redis_client,
        subject_email=claims.subject_email,
        subject_issuer=claims.subject_issuer,
        account_id=None,
        client_id=state.client_id,
        device_label=state.device_label,
        prefix=PREFIX_OAUTH_EXTERNAL_SSO,
        ttl_days=ttl_days,
    )

    poll_payload = {
        "token": mint.token,
        "expires_at": mint.expires_at.isoformat(),
        "subject_type": SubjectType.EXTERNAL_SSO,
        "subject_email": claims.subject_email,
        "subject_issuer": claims.subject_issuer,
        "account": None,
        "workspaces": [],
        "default_workspace_id": None,
        "token_id": str(mint.token_id),
    }

    try:
        store.approve(
            device_code,
            subject_email=claims.subject_email,
            account_id=None,
            subject_issuer=claims.subject_issuer,
            minted_token=mint.token,
            token_id=str(mint.token_id),
            poll_payload=poll_payload,
        )
    except (StateNotFound, InvalidTransition) as e:
        logger.error("approve-external: state transition raced: %s", e)
        raise Conflict("state_lost") from e

    _emit_approve_external_audit(state, claims, mint)

    resp = make_response(jsonify({"status": "approved"}), 200)
    resp.set_cookie(**approval_grant_cleared_cookie_kwargs())
    return resp


def _emit_approve_external_audit(state, claims, mint) -> None:
    logger.warning(
        "audit: oauth.device_flow_approved subject_type=%s "
        "subject_email=%s subject_issuer=%s token_id=%s",
        SubjectType.EXTERNAL_SSO, claims.subject_email, claims.subject_issuer, mint.token_id,
        extra={
            "audit": True,
            "event": "oauth.device_flow_approved",
            "subject_type": SubjectType.EXTERNAL_SSO,
            "subject_email": claims.subject_email,
            "subject_issuer": claims.subject_issuer,
            "token_id": str(mint.token_id),
            "client_id": state.client_id,
            "device_label": state.device_label,
            "scopes": ["apps:run"],
            "expires_at": mint.expires_at.isoformat(),
        },
    )
