"""User-scoped account endpoints. /account is the bearer-authed
identity read; /account/sessions and /account/sessions/<id> manage
the user's active OAuth tokens (Phase C steps 11–12).

The /account class is also registered on the legacy /v1/me path from
service_api/oauth.py until Phase F retires that mount. Likewise
/account/sessions/self is re-mounted at /v1/oauth/authorizations/self.
"""
from __future__ import annotations

from datetime import UTC, datetime

from flask import g
from flask_restx import Resource
from sqlalchemy import and_, select, update
from werkzeug.exceptions import BadRequest, NotFound

from controllers.openapi import openapi_ns
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.oauth_bearer import (
    ACCEPT_USER_ANY,
    AuthContext,
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


@openapi_ns.route("/account")
class AccountApi(Resource):
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


@openapi_ns.route("/account/sessions/self")
class AccountSessionsSelfApi(Resource):
    @validate_bearer(accept=ACCEPT_USER_ANY)
    def delete(self):
        ctx = g.auth_ctx
        _require_oauth_subject(ctx)
        _revoke_token_by_id(str(ctx.token_id))
        return {"status": "revoked"}, 200


@openapi_ns.route("/account/sessions")
class AccountSessionsApi(Resource):
    @validate_bearer(accept=ACCEPT_USER_ANY)
    def get(self):
        ctx = g.auth_ctx
        now = datetime.now(UTC)
        rows = db.session.execute(
            select(
                OAuthAccessToken.id,
                OAuthAccessToken.prefix,
                OAuthAccessToken.client_id,
                OAuthAccessToken.device_label,
                OAuthAccessToken.created_at,
                OAuthAccessToken.last_used_at,
                OAuthAccessToken.expires_at,
            )
            .where(
                and_(
                    *_subject_match(ctx),
                    OAuthAccessToken.revoked_at.is_(None),
                    OAuthAccessToken.token_hash.is_not(None),
                    OAuthAccessToken.expires_at > now,
                )
            )
            .order_by(OAuthAccessToken.created_at.desc())
        ).all()

        return {
            "sessions": [
                {
                    "id": str(r.id),
                    "prefix": r.prefix,
                    "client_id": r.client_id,
                    "device_label": r.device_label,
                    "created_at": _iso(r.created_at),
                    "last_used_at": _iso(r.last_used_at),
                    "expires_at": _iso(r.expires_at),
                }
                for r in rows
            ]
        }, 200


@openapi_ns.route("/account/sessions/<string:session_id>")
class AccountSessionByIdApi(Resource):
    @validate_bearer(accept=ACCEPT_USER_ANY)
    def delete(self, session_id: str):
        ctx = g.auth_ctx
        _require_oauth_subject(ctx)

        # Subject-match guard. 404 (not 403) on cross-subject so the
        # endpoint doesn't leak token IDs that belong to other subjects.
        owns = db.session.execute(
            select(OAuthAccessToken.id)
            .where(
                and_(
                    OAuthAccessToken.id == session_id,
                    *_subject_match(ctx),
                )
            )
        ).first()
        if owns is None:
            raise NotFound("session not found")

        _revoke_token_by_id(session_id)
        return {"status": "revoked"}, 200


def _subject_match(ctx: AuthContext) -> tuple:
    """Where-clauses that scope a query to the bearer's subject. Works
    for both account (account_id) and external_sso (email + issuer).
    """
    if ctx.subject_type == SubjectType.ACCOUNT:
        return (OAuthAccessToken.account_id == str(ctx.account_id),)
    return (
        OAuthAccessToken.subject_email == ctx.subject_email,
        OAuthAccessToken.subject_issuer == ctx.subject_issuer,
        OAuthAccessToken.account_id.is_(None),
    )


def _require_oauth_subject(ctx: AuthContext) -> None:
    if not ctx.source.startswith("oauth"):
        raise BadRequest(
            "this endpoint revokes OAuth bearer tokens; "
            "use /openapi/v1/personal-access-tokens/self for PATs"
        )


def _revoke_token_by_id(token_id: str) -> None:
    # Snapshot pre-revoke hash for cache invalidation; UPDATE WHERE
    # makes double-revoke idempotent.
    row = (
        db.session.query(OAuthAccessToken.token_hash)
        .filter(
            OAuthAccessToken.id == token_id,
            OAuthAccessToken.revoked_at.is_(None),
        )
        .one_or_none()
    )
    pre_revoke_hash = row[0] if row else None

    stmt = (
        update(OAuthAccessToken)
        .where(
            OAuthAccessToken.id == token_id,
            OAuthAccessToken.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC), token_hash=None)
    )
    db.session.execute(stmt)
    db.session.commit()

    if pre_revoke_hash:
        redis_client.delete(TOKEN_CACHE_KEY_FMT.format(hash=pre_revoke_hash))


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


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
