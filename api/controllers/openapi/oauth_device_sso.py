"""SSO-branch device-flow endpoints under /openapi/v1/oauth/device/*.
EE-only. Browser flow:

  GET  /oauth/device/sso-initiate     → 302 to IdP authorize URL
  GET  /oauth/device/sso-complete     → ACS callback, sets approval-grant cookie
  GET  /oauth/device/approval-context → SPA reads cookie claims (idempotent)
  POST /oauth/device/approve-external → mints dfoe_ token + clears cookie

Function-based (raw @bp.route) rather than Resource classes because the
handlers do redirects + cookie kwargs that don't fit the Resource shape.
Same handlers are also re-registered on the legacy /v1/* paths from
controllers/oauth_device_sso.py until Phase F retires the legacy mount.
"""
from __future__ import annotations

import logging
import secrets

from flask import jsonify, make_response, redirect, request
from werkzeug.exceptions import (
    BadGateway,
    BadRequest,
    Conflict,
    Forbidden,
    NotFound,
    Unauthorized,
)

from controllers.openapi import bp
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs import jws
from libs.device_flow_security import (
    APPROVAL_GRANT_COOKIE_NAME,
    ApprovalGrantClaims,
    approval_grant_cleared_cookie_kwargs,
    approval_grant_cookie_kwargs,
    consume_approval_grant_nonce,
    consume_sso_assertion_nonce,
    enterprise_only,
    mint_approval_grant,
    verify_approval_grant,
)
from libs.oauth_bearer import SubjectType
from libs.rate_limit import (
    LIMIT_APPROVE_EXT_PER_EMAIL,
    LIMIT_SSO_INITIATE_PER_IP,
    enforce,
    rate_limit,
)
from services.enterprise.enterprise_service import EnterpriseService
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
