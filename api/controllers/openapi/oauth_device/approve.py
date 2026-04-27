"""POST /openapi/v1/oauth/device/approve — user approves a pending
device flow from the /device page. Console-session authed (the user is
signed in via cookie when they hit Approve in the SPA).

The class is also registered on console_ns at /console/api/oauth/device/approve
from console/auth/oauth_device.py until Phase F retires that mount.
"""
from __future__ import annotations

import logging

from flask_login import login_required
from flask_restx import Resource, reqparse

from controllers.console.wraps import account_initialization_required, setup_required
from controllers.openapi import openapi_ns
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.login import current_account_with_tenant
from libs.oauth_bearer import SubjectType, bearer_feature_required
from libs.rate_limit import LIMIT_APPROVE_CONSOLE, rate_limit
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


@openapi_ns.route("/oauth/device/approve")
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


# Legacy /console/api/oauth/device/approve mount — handler defined above.
# Removed in Phase F. The console_ns import is local to defer past
# circular-import resolution between this module and controllers.console.
def _register_legacy_console_mount() -> None:
    from controllers.console import console_ns
    console_ns.add_resource(DeviceApproveApi, "/oauth/device/approve")


_register_legacy_console_mount()
