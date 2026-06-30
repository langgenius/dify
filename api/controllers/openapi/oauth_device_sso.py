"""SSO-branch device-flow endpoints under /openapi/v1/oauth/device/*.
EE-only. Browser flow:

  GET  /oauth/device/sso-initiate     → 302 to IdP authorize URL
  GET  /oauth/device/sso-complete     → ACS callback, sets approval-grant cookie
  GET  /oauth/device/approval-context → SPA reads cookie claims (idempotent)
  POST /oauth/device/approve-external → mints dfoe_ token + clears cookie

Function-based (raw @bp.route) rather than Resource classes because the
handlers do redirects + cookie kwargs that don't fit the Resource shape.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

from flask import jsonify, make_response, redirect, request
from pydantic import ValidationError
from werkzeug.exceptions import (
    BadGateway,
    BadRequest,
    Conflict,
    Forbidden,
    NotFound,
    Unauthorized,
)

from configs import dify_config
from controllers.openapi import bp
from controllers.openapi._models import ExtSubjectAssertionClaims
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
from libs.oauth_bearer import MINTABLE_PROFILES, SubjectType
from libs.rate_limit import (
    LIMIT_APPROVE_EXT_PER_EMAIL,
    LIMIT_SSO_INITIATE_PER_IP,
    enforce,
    rate_limit,
)
from services.account_service import AccountService
from services.enterprise.enterprise_service import EnterpriseService
from services.oauth_device_flow import (
    DeviceFlowRedis,
    DeviceFlowStatus,
    InvalidTransitionError,
    PollPayload,
    StateNotFoundError,
    mint_oauth_token,
    oauth_ttl_days,
)
from services.openapi.mint_policy import MintPolicyViolation, validate_mint_policy

logger = logging.getLogger(__name__)


# Matches DEVICE_FLOW_TTL_SECONDS so the signed state can't outlive the
# device_code it references.
STATE_ENVELOPE_TTL_SECONDS = 15 * 60

# Canonical sso-complete path. IdP-side ACS callback URL must point here.
_SSO_COMPLETE_PATH = "/openapi/v1/oauth/device/sso-complete"

_ALLOWED_SSO_ERRORS = {"sso_failed", "email_belongs_to_dify_account"}


def _device_error_redirect(code: str, user_code: str | None = None):
    safe_code = code if code in _ALLOWED_SSO_ERRORS else "sso_failed"
    params: dict[str, str] = {"sso_error": safe_code}
    if user_code:
        params["user_code"] = user_code
    return redirect(f"/device?{urlencode(params)}", code=302)


def _trusted_origin() -> str:
    base = (dify_config.CONSOLE_API_URL or "").rstrip("/")
    if not base:
        raise BadGateway("console_api_url_unset")
    return base


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

    origin = _trusted_origin()
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
            "idp_callback_url": f"{origin}{_SSO_COMPLETE_PATH}",
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
    try:
        return _sso_complete_impl()
    except Exception:
        logger.exception("sso-complete: unhandled")
        return _device_error_redirect("sso_failed")


def _sso_complete_impl():
    inbound_error = request.args.get("sso_error")
    if inbound_error:
        return _device_error_redirect(inbound_error, request.args.get("user_code"))

    blob = request.args.get("sso_assertion")
    if not blob:
        return _device_error_redirect("sso_failed")

    keyset = jws.KeySet.from_shared_secret()

    try:
        raw_claims = jws.verify(keyset, blob, expected_aud=jws.AUD_EXT_SUBJECT_ASSERTION)
    except jws.VerifyError as e:
        logger.warning("sso-complete: rejected assertion: %s", e)
        return _device_error_redirect("sso_failed")

    try:
        claims = ExtSubjectAssertionClaims.model_validate(raw_claims)
    except ValidationError as e:
        logger.warning("sso-complete: claim shape invalid: %s", e)
        return _device_error_redirect("sso_failed")

    user_code = claims.user_code.strip().upper()

    if not consume_sso_assertion_nonce(redis_client, claims.nonce):
        return _device_error_redirect("sso_failed", user_code)

    store = DeviceFlowRedis(redis_client)
    found = store.load_by_user_code(user_code)
    if found is None:
        return _device_error_redirect("sso_failed", user_code)
    _, state = found
    if state.status is not DeviceFlowStatus.PENDING:
        return _device_error_redirect("sso_failed", user_code)

    if AccountService.has_active_account_with_email(db.session, claims.email):
        _emit_external_rejection_audit(
            state,
            _RejectedClaims(subject_email=claims.email, subject_issuer=claims.issuer),
            reason="email_belongs_to_dify_account",
        )
        return _device_error_redirect("email_belongs_to_dify_account", user_code)

    iss = _trusted_origin()
    cookie_value, _ = mint_approval_grant(
        keyset=keyset,
        iss=iss,
        subject_email=claims.email,
        subject_issuer=claims.issuer,
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

    return jsonify(
        {
            "subject_email": claims.subject_email,
            "subject_issuer": claims.subject_issuer,
            "user_code": claims.user_code,
            "csrf_token": claims.csrf_token,
            "expires_at": claims.expires_at.isoformat(),
        }
    ), 200


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
    if not csrf_header or not secrets.compare_digest(csrf_header, claims.csrf_token):
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

    if AccountService.has_active_account_with_email(db.session, claims.subject_email):
        _emit_external_rejection_audit(state, claims, reason="email_belongs_to_dify_account")
        raise Forbidden("email_belongs_to_dify_account")

    if not consume_approval_grant_nonce(redis_client, claims.nonce):
        raise Unauthorized("session_already_consumed")

    profile = MINTABLE_PROFILES[SubjectType.EXTERNAL_SSO]
    try:
        validate_mint_policy(
            subject_type=profile.subject_type,
            prefix=profile.prefix,
            scopes=profile.scopes,
        )
    except MintPolicyViolation as e:
        raise BadRequest(description=str(e)) from None

    ttl_days = oauth_ttl_days(tenant_id=None)
    mint = mint_oauth_token(
        db.session,
        redis_client,
        subject_email=claims.subject_email,
        subject_issuer=claims.subject_issuer,
        account_id=None,
        client_id=state.client_id,
        device_label=state.device_label,
        prefix=profile.prefix,
        ttl_days=ttl_days,
    )

    # SSO branch of the shared PollPayload contract: account/workspace
    # fields are zero-filled (`None` / `[]`) for parity with the account
    # branch in `oauth_device._build_account_poll_payload`.
    poll_payload: PollPayload = {
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
    except (StateNotFoundError, InvalidTransitionError) as e:
        logger.exception("approve-external: state transition raced")
        raise Conflict("state_lost") from e

    _emit_approve_external_audit(state, claims, mint)

    resp = make_response(jsonify({"status": "approved"}), 200)
    resp.set_cookie(**approval_grant_cleared_cookie_kwargs())
    return resp


@dataclass(frozen=True)
class _RejectedClaims:
    """Minimal subject shape consumed by `_emit_external_rejection_audit`.

    Mirrors the attributes used from `ApprovalGrantClaims` so callers holding
    only a raw JWS claims dict (e.g. `sso_complete`) can emit the same audit
    event without reaching for the full dataclass.
    """

    subject_email: str
    subject_issuer: str


def _emit_external_rejection_audit(state, claims, *, reason: str) -> None:
    logger.warning(
        "audit: oauth.device_flow_rejected subject_type=%s subject_email=%s subject_issuer=%s reason=%s",
        SubjectType.EXTERNAL_SSO,
        claims.subject_email,
        claims.subject_issuer,
        reason,
        extra={
            "audit": True,
            "event": "oauth.device_flow_rejected",
            "subject_type": SubjectType.EXTERNAL_SSO,
            "subject_email": claims.subject_email,
            "subject_issuer": claims.subject_issuer,
            "reason": reason,
            "client_id": state.client_id,
            "device_label": state.device_label,
        },
    )


def _emit_approve_external_audit(state, claims, mint) -> None:
    logger.warning(
        "audit: oauth.device_flow_approved subject_type=%s subject_email=%s subject_issuer=%s token_id=%s",
        SubjectType.EXTERNAL_SSO,
        claims.subject_email,
        claims.subject_issuer,
        mint.token_id,
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
