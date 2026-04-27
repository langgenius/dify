"""``/v1`` OAuth bearer + device-flow endpoints. ``/me`` and self-revoke
are bearer-authed; the device-flow trio (code/token/lookup) is public —
code/token per RFC 8628, lookup so the /device page can pre-validate
before the user has a console session.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime

from flask import g
from flask_restx import Resource
from sqlalchemy import update
from werkzeug.exceptions import BadRequest

from controllers.openapi.oauth_device.code import OAuthDeviceCodeApi
from controllers.openapi.oauth_device.lookup import OAuthDeviceLookupApi
from controllers.openapi.oauth_device.token import OAuthDeviceTokenApi
from controllers.service_api import service_api_ns
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.oauth_bearer import (
    ACCEPT_USER_ANY,
    SubjectType,
    TOKEN_CACHE_KEY_FMT,
    validate_bearer,
)
from libs.rate_limit import (
    LIMIT_ME_PER_ACCOUNT,
    LIMIT_ME_PER_EMAIL,
    enforce,
)
from models import Account, OAuthAccessToken, Tenant, TenantAccountJoin

logger = logging.getLogger(__name__)

# Legacy /v1/* mounts — handlers live in controllers/openapi/oauth_device/.
# Removed in Phase F.
service_api_ns.add_resource(OAuthDeviceCodeApi, "/oauth/device/code")
service_api_ns.add_resource(OAuthDeviceTokenApi, "/oauth/device/token")
service_api_ns.add_resource(OAuthDeviceLookupApi, "/oauth/device/lookup")


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



