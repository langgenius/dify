"""Device-flow endpoints under /openapi/v1/oauth/device/*. Two
sub-groups in one module:

  Protocol (RFC 8628, public + rate-limited):
    POST /oauth/device/code
    POST /oauth/device/token
    GET  /oauth/device/lookup

  Approval (account branch, console-cookie authed):
    POST /oauth/device/approve
    POST /oauth/device/deny

SSO branch lives in oauth_device_sso.py.
"""

from __future__ import annotations

import logging
from typing import Any

from flask import request
from flask_login import login_required
from flask_restx import Resource
from pydantic import BaseModel, ValidationError
from werkzeug.exceptions import BadRequest

from configs import dify_config
from controllers.common.schema import query_params_from_model
from controllers.console.wraps import account_initialization_required, setup_required
from controllers.openapi import openapi_ns
from controllers.openapi._models import (
    AccountPayload,
    DeviceCodeRequest,
    DeviceCodeResponse,
    DeviceLookupQuery,
    DeviceLookupResponse,
    DeviceMutateRequest,
    DeviceMutateResponse,
    DevicePollRequest,
    WorkspacePayload,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.helper import extract_remote_ip
from libs.login import current_account_with_tenant
from libs.oauth_bearer import MINTABLE_PROFILES, SubjectType, bearer_feature_required
from libs.rate_limit import (
    LIMIT_APPROVE_CONSOLE,
    LIMIT_DEVICE_CODE_PER_IP,
    LIMIT_LOOKUP_PUBLIC,
    rate_limit,
)
from services.account_service import TenantService
from services.oauth_device_flow import (
    ACCOUNT_ISSUER_SENTINEL,
    DEFAULT_POLL_INTERVAL_SECONDS,
    DEVICE_FLOW_TTL_SECONDS,
    DeviceFlowRedis,
    DeviceFlowStatus,
    InvalidTransitionError,
    PollPayload,
    SlowDownDecision,
    StateNotFoundError,
    mint_oauth_token,
    oauth_ttl_days,
)
from services.openapi.mint_policy import MintPolicyViolation, validate_mint_policy

logger = logging.getLogger(__name__)


# =========================================================================
# Validation helpers
# =========================================================================


def _validate_json[M: BaseModel](model: type[M]) -> M:
    body = request.get_json(silent=True) or {}
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        raise BadRequest(str(exc))


def _validate_query[M: BaseModel](model: type[M]) -> M:
    try:
        return model.model_validate(request.args.to_dict(flat=True))
    except ValidationError as exc:
        raise BadRequest(str(exc))


# =========================================================================
# Protocol endpoints — RFC 8628 (public + per-IP rate limit)
# =========================================================================


@openapi_ns.route("/oauth/device/code")
class OAuthDeviceCodeApi(Resource):
    @openapi_ns.expect(openapi_ns.models[DeviceCodeRequest.__name__])
    @openapi_ns.response(200, "Device code created", openapi_ns.models[DeviceCodeResponse.__name__])
    @rate_limit(LIMIT_DEVICE_CODE_PER_IP)
    def post(self):
        payload = _validate_json(DeviceCodeRequest)
        client_id = payload.client_id
        device_label = payload.device_label

        if client_id not in dify_config.OPENAPI_KNOWN_CLIENT_IDS:
            return {"error": "unsupported_client"}, 400

        store = DeviceFlowRedis(redis_client)
        ip = extract_remote_ip(request)
        device_code, user_code, expires_in = store.start(client_id, device_label, created_ip=ip)

        return {
            "device_code": device_code,
            "user_code": user_code,
            "verification_uri": _verification_uri(),
            "expires_in": expires_in,
            "interval": DEFAULT_POLL_INTERVAL_SECONDS,
        }, 200


@openapi_ns.route("/oauth/device/token")
class OAuthDeviceTokenApi(Resource):
    """RFC 8628 poll."""

    @openapi_ns.expect(openapi_ns.models[DevicePollRequest.__name__])
    def post(self):
        payload = _validate_json(DevicePollRequest)
        device_code = payload.device_code

        store = DeviceFlowRedis(redis_client)

        # slow_down beats every other branch — polling-too-fast clients
        # see only that response regardless of underlying state.
        if store.record_poll(device_code, DEFAULT_POLL_INTERVAL_SECONDS) is SlowDownDecision.SLOW_DOWN:
            return {"error": "slow_down"}, 400

        state = store.load_by_device_code(device_code)
        if state is None:
            return {"error": "expired_token"}, 400

        if state.status is DeviceFlowStatus.PENDING:
            return {"error": "authorization_pending"}, 400

        terminal = store.consume_on_poll(device_code)
        if terminal is None:
            return {"error": "expired_token"}, 400

        if terminal.status is DeviceFlowStatus.DENIED:
            return {"error": "access_denied"}, 400

        poll_payload: PollPayload | dict[str, Any] = terminal.poll_payload or {}
        if "token" not in poll_payload:
            logger.error("device_flow: approved state missing poll_payload for %s", device_code)
            return {"error": "expired_token"}, 400

        _audit_cross_ip_if_needed(state)
        return poll_payload, 200


@openapi_ns.route("/oauth/device/lookup")
class OAuthDeviceLookupApi(Resource):
    """Read-only — public for pre-validate before login. user_code is
    high-entropy + short-TTL; per-IP rate limit blocks enumeration.
    """

    @openapi_ns.doc(params=query_params_from_model(DeviceLookupQuery))
    @openapi_ns.response(200, "Device lookup result", openapi_ns.models[DeviceLookupResponse.__name__])
    @rate_limit(LIMIT_LOOKUP_PUBLIC)
    def get(self):
        payload = _validate_query(DeviceLookupQuery)
        user_code = payload.user_code.strip().upper()

        store = DeviceFlowRedis(redis_client)
        found = store.load_by_user_code(user_code)
        if found is None:
            return {"valid": False, "expires_in_remaining": 0, "client_id": None}, 200

        _device_code, state = found
        if state.status is not DeviceFlowStatus.PENDING:
            return {"valid": False, "expires_in_remaining": 0, "client_id": state.client_id}, 200

        return {
            "valid": True,
            "expires_in_remaining": DEVICE_FLOW_TTL_SECONDS,
            "client_id": state.client_id,
        }, 200


# =========================================================================
# Approval endpoints — account branch (cookie-authed)
# =========================================================================


_APPROVE_GUARD_KEY_FMT = "device_code:{code}:approving"
_APPROVE_GUARD_TTL_SECONDS = 10


@openapi_ns.route("/oauth/device/approve")
class DeviceApproveApi(Resource):
    @openapi_ns.expect(openapi_ns.models[DeviceMutateRequest.__name__])
    @openapi_ns.response(200, "Approved", openapi_ns.models[DeviceMutateResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @bearer_feature_required
    @rate_limit(LIMIT_APPROVE_CONSOLE)
    def post(self):
        payload = _validate_json(DeviceMutateRequest)
        user_code = payload.user_code.strip().upper()

        account, tenant = current_account_with_tenant()
        store = DeviceFlowRedis(redis_client)

        found = store.load_by_user_code(user_code)
        if found is None:
            return {"error": "expired_or_unknown"}, 404
        device_code, state = found
        if state.status is not DeviceFlowStatus.PENDING:
            return {"error": "already_resolved"}, 409

        # SET NX guard — without it, two in-flight approves both pass
        # PENDING, both mint, and the second upsert silently rotates the
        # first caller into an already-revoked token.
        guard_key = _APPROVE_GUARD_KEY_FMT.format(code=device_code)
        if not redis_client.set(guard_key, "1", nx=True, ex=_APPROVE_GUARD_TTL_SECONDS):
            return {"error": "approve_in_progress"}, 409

        try:
            profile = MINTABLE_PROFILES[SubjectType.ACCOUNT]
            try:
                validate_mint_policy(
                    subject_type=profile.subject_type,
                    prefix=profile.prefix,
                    scopes=profile.scopes,
                )
            except MintPolicyViolation as e:
                raise BadRequest(description=str(e)) from None
            ttl_days = oauth_ttl_days(tenant_id=tenant)
            mint = mint_oauth_token(
                db.session,
                redis_client,
                subject_email=account.email,
                subject_issuer=ACCOUNT_ISSUER_SENTINEL,
                account_id=str(account.id),
                client_id=state.client_id,
                device_label=state.device_label,
                prefix=profile.prefix,
                ttl_days=ttl_days,
            )

            poll_payload = _build_account_poll_payload(account, tenant, mint)
            try:
                store.approve(
                    device_code,
                    subject_email=account.email,
                    account_id=str(account.id),
                    subject_issuer=ACCOUNT_ISSUER_SENTINEL,
                    minted_token=mint.token,
                    token_id=str(mint.token_id),
                    poll_payload=poll_payload,
                )
            except (StateNotFoundError, InvalidTransitionError):
                # Row minted but state vanished — roll forward; the orphan
                # token is revocable via auth devices list / Authorized Apps.
                logger.exception("device_flow: approve raced on %s", device_code)
                return {"error": "state_lost"}, 409
        finally:
            redis_client.delete(guard_key)

        _emit_approve_audit(state, account, tenant, mint)
        return {"status": "approved"}, 200


@openapi_ns.route("/oauth/device/deny")
class DeviceDenyApi(Resource):
    @openapi_ns.expect(openapi_ns.models[DeviceMutateRequest.__name__])
    @openapi_ns.response(200, "Denied", openapi_ns.models[DeviceMutateResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @bearer_feature_required
    @rate_limit(LIMIT_APPROVE_CONSOLE)
    def post(self):
        payload = _validate_json(DeviceMutateRequest)
        user_code = payload.user_code.strip().upper()

        store = DeviceFlowRedis(redis_client)
        found = store.load_by_user_code(user_code)
        if found is None:
            return {"error": "expired_or_unknown"}, 404
        device_code, state = found
        if state.status is not DeviceFlowStatus.PENDING:
            return {"error": "already_resolved"}, 409

        try:
            store.deny(device_code)
        except (StateNotFoundError, InvalidTransitionError):
            logger.exception("device_flow: deny raced on %s", device_code)
            return {"error": "state_lost"}, 409

        _emit_deny_audit(state)
        return {"status": "denied"}, 200


# =========================================================================
# Helpers
# =========================================================================


def _verification_uri() -> str:
    base = getattr(dify_config, "CONSOLE_WEB_URL", None)
    if base:
        return f"{base.rstrip('/')}/device"
    return f"{request.host_url.rstrip('/')}/device"


def _audit_cross_ip_if_needed(state) -> None:
    poll_ip = extract_remote_ip(request)
    if state.created_ip and poll_ip and poll_ip != state.created_ip:
        logger.warning(
            "audit: oauth.device_code_cross_ip_poll token_id=%s creation_ip=%s poll_ip=%s",
            state.token_id,
            state.created_ip,
            poll_ip,
            extra={
                "audit": True,
                "token_id": state.token_id,
                "creation_ip": state.created_ip,
                "poll_ip": poll_ip,
            },
        )


def _build_account_poll_payload(account, tenant, mint) -> PollPayload:
    rows = TenantService.get_workspaces_for_account(db.session, str(account.id))
    workspaces = [WorkspacePayload(id=str(t.id), name=t.name, role=getattr(m, "role", "")) for t, m in rows]
    # Prefer active session tenant → DB-flagged current join → first membership.
    default_ws_id = None
    if tenant and any(w.id == str(tenant) for w in workspaces):
        default_ws_id = str(tenant)
    if default_ws_id is None:
        for _t, m in rows:
            if getattr(m, "current", False):
                default_ws_id = str(m.tenant_id)
                break
    if default_ws_id is None and workspaces:
        default_ws_id = workspaces[0].id

    payload: PollPayload = {
        "token": mint.token,
        "expires_at": mint.expires_at.isoformat(),
        "subject_type": SubjectType.ACCOUNT,
        "account": AccountPayload(id=str(account.id), email=account.email, name=account.name).model_dump(mode="json"),
        "workspaces": [w.model_dump(mode="json") for w in workspaces],
        "default_workspace_id": default_ws_id,
        "token_id": str(mint.token_id),
    }
    return payload


def _emit_approve_audit(state, account, tenant, mint) -> None:
    logger.warning(
        "audit: oauth.device_flow_approved token_id=%s subject=%s client_id=%s device_label=%s rotated=? expires_at=%s",
        mint.token_id,
        account.email,
        state.client_id,
        state.device_label,
        mint.expires_at,
        extra={
            "audit": True,
            "event": "oauth.device_flow_approved",
            "token_id": str(mint.token_id),
            "subject_type": SubjectType.ACCOUNT,
            "subject_email": account.email,
            "account_id": str(account.id),
            "tenant_id": tenant,
            "client_id": state.client_id,
            "device_label": state.device_label,
            "scopes": ["full"],
            "expires_at": mint.expires_at.isoformat(),
        },
    )


def _emit_deny_audit(state) -> None:
    logger.warning(
        "audit: oauth.device_flow_denied client_id=%s device_label=%s",
        state.client_id,
        state.device_label,
        extra={
            "audit": True,
            "event": "oauth.device_flow_denied",
            "client_id": state.client_id,
            "device_label": state.device_label,
        },
    )
