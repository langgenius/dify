"""Console-session-authed device-flow approve/deny. Called by the
/device page after the user signs in. Public lookup is in service_api/oauth.py.
"""
from __future__ import annotations

import logging

from functools import wraps

from flask_login import login_required
from flask_restx import Resource, reqparse
from werkzeug.exceptions import ServiceUnavailable

from configs import dify_config
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.login import current_account_with_tenant
from libs.oauth_bearer import SubjectType
from libs.rate_limit import LIMIT_APPROVE_CONSOLE, rate_limit


def bearer_feature_required(fn):
    """503 if ENABLE_OAUTH_BEARER is off — minted tokens would be unusable
    without the authenticator, so fail fast instead of approving silently.
    """

    @wraps(fn)
    def inner(*args, **kwargs):
        if not dify_config.ENABLE_OAUTH_BEARER:
            raise ServiceUnavailable(
                "bearer_auth_disabled: set ENABLE_OAUTH_BEARER=true to enable"
            )
        return fn(*args, **kwargs)

    return inner
from services.oauth_device_flow import (
    ACCOUNT_ISSUER_SENTINEL,
    PREFIX_OAUTH_ACCOUNT,
    DeviceFlowRedis,
    DeviceFlowStatus,
    InvalidTransition,
    StateNotFound,
    mint_oauth_token,
    oauth_ttl_days,
)

logger = logging.getLogger(__name__)


_mutate_parser = reqparse.RequestParser()
_mutate_parser.add_argument("user_code", type=str, required=True, location="json")


_APPROVE_GUARD_KEY_FMT = "device_code:{code}:approving"
_APPROVE_GUARD_TTL_SECONDS = 10


@console_ns.route("/oauth/device/approve")
class DeviceApproveApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @bearer_feature_required
    @rate_limit(LIMIT_APPROVE_CONSOLE)
    def post(self):
        args = _mutate_parser.parse_args()
        user_code = args["user_code"].strip().upper()

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
            ttl_days = oauth_ttl_days(tenant_id=tenant)
            mint = mint_oauth_token(
                db.session,
                redis_client,
                subject_email=account.email,
                subject_issuer=ACCOUNT_ISSUER_SENTINEL,
                account_id=str(account.id),
                client_id=state.client_id,
                device_label=state.device_label,
                prefix=PREFIX_OAUTH_ACCOUNT,
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
            except (StateNotFound, InvalidTransition) as e:
                # Row minted but state vanished — roll forward; the orphan
                # token is revocable via auth devices list / Authorized Apps.
                logger.error("device_flow: approve raced on %s: %s", device_code, e)
                return {"error": "state_lost"}, 409
        finally:
            redis_client.delete(guard_key)

        _emit_approve_audit(state, account, tenant, mint)
        return {"status": "approved"}, 200


@console_ns.route("/oauth/device/deny")
class DeviceDenyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @bearer_feature_required
    @rate_limit(LIMIT_APPROVE_CONSOLE)
    def post(self):
        args = _mutate_parser.parse_args()
        user_code = args["user_code"].strip().upper()

        store = DeviceFlowRedis(redis_client)
        found = store.load_by_user_code(user_code)
        if found is None:
            return {"error": "expired_or_unknown"}, 404
        device_code, state = found
        if state.status is not DeviceFlowStatus.PENDING:
            return {"error": "already_resolved"}, 409

        try:
            store.deny(device_code)
        except (StateNotFound, InvalidTransition) as e:
            logger.error("device_flow: deny raced on %s: %s", device_code, e)
            return {"error": "state_lost"}, 409

        _emit_deny_audit(state)
        return {"status": "denied"}, 200


def _build_account_poll_payload(account, tenant, mint) -> dict:
    """Pre-render the poll-response body so the unauthenticated poll
    handler doesn't re-query accounts/tenants for authz data.
    """
    from models import Tenant, TenantAccountJoin
    rows = (
        db.session.query(Tenant, TenantAccountJoin)
        .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
        .filter(TenantAccountJoin.account_id == account.id)
        .all()
    )
    workspaces = [
        {"id": str(t.id), "name": t.name, "role": getattr(m, "role", "")}
        for t, m in rows
    ]
    # Prefer active session tenant → DB-flagged current join → first membership.
    default_ws_id = None
    if tenant and any(w["id"] == str(tenant) for w in workspaces):
        default_ws_id = str(tenant)
    if default_ws_id is None:
        for _t, m in rows:
            if getattr(m, "current", False):
                default_ws_id = str(m.tenant_id)
                break
    if default_ws_id is None and workspaces:
        default_ws_id = workspaces[0]["id"]

    return {
        "token": mint.token,
        "expires_at": mint.expires_at.isoformat(),
        "subject_type": SubjectType.ACCOUNT,
        "account": {"id": str(account.id), "email": account.email, "name": account.name},
        "workspaces": workspaces,
        "default_workspace_id": default_ws_id,
        "token_id": str(mint.token_id),
    }


def _emit_approve_audit(state, account, tenant, mint) -> None:
    logger.warning(
        "audit: oauth.device_flow_approved token_id=%s subject=%s client_id=%s device_label=%s rotated=? expires_at=%s",
        mint.token_id, account.email, state.client_id, state.device_label, mint.expires_at,
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
        state.client_id, state.device_label,
        extra={
            "audit": True,
            "event": "oauth.device_flow_denied",
            "client_id": state.client_id,
            "device_label": state.device_label,
        },
    )
