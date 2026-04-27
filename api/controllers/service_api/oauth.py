"""``/v1`` OAuth bearer + device-flow endpoints. ``/me`` and self-revoke
are bearer-authed; the device-flow trio (code/token/lookup) is public —
code/token per RFC 8628, lookup so the /device page can pre-validate
before the user has a console session.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime

from flask import g, request
from flask_restx import Resource, reqparse
from sqlalchemy import update
from werkzeug.exceptions import BadRequest

from controllers.service_api import service_api_ns
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.helper import extract_remote_ip
from libs.oauth_bearer import (
    ACCEPT_USER_ANY,
    SubjectType,
    TOKEN_CACHE_KEY_FMT,
    validate_bearer,
)
from libs.rate_limit import (
    LIMIT_DEVICE_CODE_PER_IP,
    LIMIT_LOOKUP_PUBLIC,
    LIMIT_ME_PER_ACCOUNT,
    LIMIT_ME_PER_EMAIL,
    enforce,
    rate_limit,
)
from models import Account, OAuthAccessToken, Tenant, TenantAccountJoin
from services.oauth_device_flow import (
    DEFAULT_POLL_INTERVAL_SECONDS,
    DEVICE_FLOW_TTL_SECONDS,
    DeviceFlowRedis,
    DeviceFlowStatus,
    SlowDownDecision,
)

logger = logging.getLogger(__name__)

KNOWN_CLIENT_IDS = frozenset({"difyctl"})


# ============================================================================
# GET /v1/me
# ============================================================================


@service_api_ns.route("/me")
class MeApi(Resource):
    @validate_bearer(accept=ACCEPT_USER_ANY)
    def get(self):
        ctx = g.auth_ctx

        if ctx.subject_type == SubjectType.EXTERNAL_SSO:
            enforce(LIMIT_ME_PER_EMAIL, key=f"subject:{ctx.subject_email}")
        else:
            enforce(LIMIT_ME_PER_ACCOUNT, key=f"account:{ctx.account_id}")

        if ctx.subject_type == SubjectType.EXTERNAL_SSO:
            return {
                "subject_type": ctx.subject_type,
                "subject_email": ctx.subject_email,
                "subject_issuer": ctx.subject_issuer,
                "account": None,
                "workspaces": [],
                "default_workspace_id": None,
            }

        account = (
            db.session.query(Account).filter(Account.id == ctx.account_id).one_or_none()
            if ctx.account_id else None
        )
        memberships = _load_memberships(ctx.account_id) if ctx.account_id else []
        default_ws_id = _pick_default_workspace(memberships)

        return {
            "subject_type": ctx.subject_type,
            "subject_email": ctx.subject_email or (account.email if account else None),
            "account": _account_payload(account) if account else None,
            "workspaces": [_workspace_payload(m) for m in memberships],
            "default_workspace_id": default_ws_id,
        }


def _load_memberships(account_id):
    return (
        db.session.query(TenantAccountJoin, Tenant)
        .join(Tenant, Tenant.id == TenantAccountJoin.tenant_id)
        .filter(TenantAccountJoin.account_id == account_id)
        .all()
    )


def _pick_default_workspace(memberships) -> str | None:
    if not memberships:
        return None
    for join, tenant in memberships:
        if getattr(join, "current", False):
            return str(tenant.id)
    return str(memberships[0][1].id)


def _workspace_payload(row) -> dict:
    join, tenant = row
    return {"id": str(tenant.id), "name": tenant.name, "role": getattr(join, "role", "")}


def _account_payload(account) -> dict:
    return {"id": str(account.id), "email": account.email, "name": account.name}


# ============================================================================
# DELETE /v1/oauth/authorizations/self
# ============================================================================


@service_api_ns.route("/oauth/authorizations/self")
class OAuthAuthorizationsSelfApi(Resource):
    @validate_bearer(accept=ACCEPT_USER_ANY)
    def delete(self):
        ctx = g.auth_ctx

        if not ctx.source.startswith("oauth"):
            raise BadRequest(
                "this endpoint revokes OAuth bearer tokens; "
                "use /v1/personal-access-tokens/self for PATs"
            )

        # Snapshot pre-revoke hash for cache invalidation; UPDATE WHERE
        # makes double-revoke idempotent.
        row = (
            db.session.query(OAuthAccessToken.token_hash)
            .filter(
                OAuthAccessToken.id == str(ctx.token_id),
                OAuthAccessToken.revoked_at.is_(None),
            )
            .one_or_none()
        )
        pre_revoke_hash = row[0] if row else None

        stmt = (
            update(OAuthAccessToken)
            .where(
                OAuthAccessToken.id == str(ctx.token_id),
                OAuthAccessToken.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.now(UTC), token_hash=None)
        )
        db.session.execute(stmt)
        db.session.commit()

        if pre_revoke_hash:
            redis_client.delete(TOKEN_CACHE_KEY_FMT.format(hash=pre_revoke_hash))

        return {"status": "revoked"}, 200


# ============================================================================
# POST /v1/oauth/device/code  (unauthenticated — CLI starts a flow)
# ============================================================================


_code_parser = reqparse.RequestParser()
_code_parser.add_argument("client_id", type=str, required=True, location="json")
_code_parser.add_argument("device_label", type=str, required=True, location="json")


@service_api_ns.route("/oauth/device/code")
class OAuthDeviceCodeApi(Resource):
    @rate_limit(LIMIT_DEVICE_CODE_PER_IP)
    def post(self):
        args = _code_parser.parse_args()
        client_id = args["client_id"]
        device_label = args["device_label"]

        if client_id not in KNOWN_CLIENT_IDS:
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


def _verification_uri() -> str:
    from configs import dify_config

    base = getattr(dify_config, "CONSOLE_WEB_URL", None)
    if base:
        return f"{base.rstrip('/')}/device"
    return f"{request.host_url.rstrip('/')}/device"


# ============================================================================
# POST /v1/oauth/device/token  (unauthenticated — CLI polls)
# ============================================================================


_poll_parser = reqparse.RequestParser()
_poll_parser.add_argument("device_code", type=str, required=True, location="json")
_poll_parser.add_argument("client_id", type=str, required=True, location="json")


@service_api_ns.route("/oauth/device/token")
class OAuthDeviceTokenApi(Resource):
    """RFC 8628 poll."""

    def post(self):
        args = _poll_parser.parse_args()
        device_code = args["device_code"]

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

        poll_payload = terminal.poll_payload or {}
        if "token" not in poll_payload:
            logger.error("device_flow: approved state missing poll_payload for %s", device_code)
            return {"error": "expired_token"}, 400

        _audit_cross_ip_if_needed(state)
        return poll_payload, 200


# ============================================================================
# GET /v1/oauth/device/lookup  (unauthenticated — /device page pre-validates)
# ============================================================================


_lookup_parser = reqparse.RequestParser()
_lookup_parser.add_argument("user_code", type=str, required=True, location="args")


@service_api_ns.route("/oauth/device/lookup")
class OAuthDeviceLookupApi(Resource):
    """Read-only — public for pre-validate before login. user_code is
    high-entropy + short-TTL; per-IP rate limit blocks enumeration.
    """

    @rate_limit(LIMIT_LOOKUP_PUBLIC)
    def get(self):
        args = _lookup_parser.parse_args()
        user_code = args["user_code"].strip().upper()

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


def _audit_cross_ip_if_needed(state) -> None:
    poll_ip = extract_remote_ip(request)
    if state.created_ip and poll_ip and poll_ip != state.created_ip:
        logger.warning(
            "audit: oauth.device_code_cross_ip_poll token_id=%s creation_ip=%s poll_ip=%s",
            state.token_id, state.created_ip, poll_ip,
            extra={
                "audit": True,
                "token_id": state.token_id,
                "creation_ip": state.created_ip,
                "poll_ip": poll_ip,
            },
        )
