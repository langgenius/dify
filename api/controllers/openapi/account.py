from __future__ import annotations

from datetime import UTC, datetime

from flask_restx import Resource
from werkzeug.exceptions import NotFound

from controllers.openapi import openapi_ns
from controllers.openapi._contract import accepts, returns
from controllers.openapi._models import (
    AccountPayload,
    AccountResponse,
    RevokeResponse,
    SessionListQuery,
    SessionListResponse,
    SessionRow,
    WorkspacePayload,
)
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.oauth_bearer import (
    Scope,
    TokenType,
    get_auth_ctx,
)
from libs.rate_limit import (
    LIMIT_ME_PER_ACCOUNT,
    enforce,
)
from services.account_service import AccountService, TenantService
from services.oauth_device_flow import (
    list_active_sessions,
    revoke_oauth_token,
    token_belongs_to_subject,
)


@openapi_ns.route("/account")
class AccountApi(Resource):
    @auth_router.guard(scope=Scope.FULL, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, AccountResponse, description="Account info")
    def get(self, *, auth_data: AuthData):
        enforce(LIMIT_ME_PER_ACCOUNT, key=f"account:{auth_data.account_id}")

        account_id_str = str(auth_data.account_id) if auth_data.account_id else None
        account = AccountService.get_account_by_id(db.session, account_id_str) if account_id_str else None
        memberships = TenantService.get_account_memberships(db.session, account_id_str) if account_id_str else []
        default_ws_id = _pick_default_workspace(memberships)

        return AccountResponse(
            subject_type="account",
            subject_email=account.email if account else None,
            account=_account_payload(account) if account else None,
            workspaces=[_workspace_payload(m) for m in memberships],
            default_workspace_id=default_ws_id,
        )


@openapi_ns.route("/account/sessions/self")
class AccountSessionsSelfApi(Resource):
    @auth_router.guard(scope=Scope.FULL, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, RevokeResponse, description="Session revoked")
    def delete(self, *, auth_data: AuthData):
        revoke_oauth_token(db.session, redis_client, str(auth_data.token_id))
        return RevokeResponse(status="revoked")


@openapi_ns.route("/account/sessions")
class AccountSessionsApi(Resource):
    @auth_router.guard(scope=Scope.FULL, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, SessionListResponse, description="Session list")
    @accepts(query=SessionListQuery)
    def get(self, *, auth_data: AuthData, query: SessionListQuery):
        # SessionListQuery enforces the advertised bounds (extra='forbid', page>=1,
        # 1<=limit<=MAX_PAGE_LIMIT) so the server rejects out-of-range paging rather
        # than silently coercing (e.g. page=0 -> empty slice).
        ctx = get_auth_ctx()
        now = datetime.now(UTC)
        page = query.page
        limit = query.limit

        all_rows = list_active_sessions(db.session, ctx, now)

        total = len(all_rows)
        sliced = all_rows[(page - 1) * limit : page * limit]

        items = [
            SessionRow(
                id=str(r.id),
                prefix=r.prefix,
                client_id=r.client_id,
                device_label=r.device_label,
                created_at=_iso(r.created_at),
                last_used_at=_iso(r.last_used_at),
                expires_at=_iso(r.expires_at),
            )
            for r in sliced
        ]

        return SessionListResponse(
            page=page,
            limit=limit,
            total=total,
            has_more=page * limit < total,
            data=items,
        )


@openapi_ns.route("/account/sessions/<string:session_id>")
class AccountSessionByIdApi(Resource):
    @auth_router.guard(scope=Scope.FULL, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, RevokeResponse, description="Session revoked")
    def delete(self, session_id: str, *, auth_data: AuthData):
        ctx = get_auth_ctx()

        # 404 (not 403) on cross-subject so the endpoint doesn't leak
        # token IDs that belong to other subjects.
        if not token_belongs_to_subject(db.session, session_id, ctx):
            raise NotFound("session not found")

        revoke_oauth_token(db.session, redis_client, session_id)
        return RevokeResponse(status="revoked")


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def _pick_default_workspace(memberships) -> str | None:
    if not memberships:
        return None
    for join, tenant in memberships:
        if getattr(join, "current", False):
            return str(tenant.id)
    return str(memberships[0][1].id)


def _workspace_payload(row) -> WorkspacePayload:
    join, tenant = row
    return WorkspacePayload(id=str(tenant.id), name=tenant.name, role=getattr(join, "role", ""))


def _account_payload(account) -> AccountPayload:
    return AccountPayload(id=str(account.id), email=account.email, name=account.name)
