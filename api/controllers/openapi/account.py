from __future__ import annotations

from datetime import UTC, datetime

from flask_restx import Resource
from werkzeug.exceptions import NotFound

from controllers.openapi import openapi_ns
from controllers.openapi._contract import endpoint
from controllers.openapi._models import (
    AccountPayload,
    AccountResponse,
    RevokeResponse,
    SessionListQuery,
    SessionListResponse,
    SessionRow,
    WorkspacePayload,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import SubjectCheck, TokenScope
from controllers.openapi.auth.subjects import AccountSubject
from extensions.ext_redis import redis_client
from libs.oauth_bearer import Scope, get_auth_ctx
from libs.rate_limit import LIMIT_ME_PER_ACCOUNT, enforce
from services.account_service import TenantService
from services.oauth_device_flow import (
    list_active_sessions,
    revoke_oauth_token,
    token_belongs_to_subject,
)

_ACCOUNT_REQUIREMENTS = (SubjectCheck(allowed=(AccountSubject,)), TokenScope(Scope.FULL))


@openapi_ns.route("/account")
class AccountApi(Resource):
    @endpoint(requirements=_ACCOUNT_REQUIREMENTS, returns=(200, AccountResponse, "Account info"), write=False)
    def get(self, ctx: Context):
        account_id_str = str(ctx.subject.account_id)
        enforce(LIMIT_ME_PER_ACCOUNT, key=f"account:{account_id_str}")

        account = ctx.caller
        memberships = TenantService.get_account_memberships(account_id_str, session=ctx.session)

        return AccountResponse(
            subject_type="account",
            subject_email=account.email,
            account=_account_payload(account),
            workspaces=[_workspace_payload(m) for m in memberships],
            default_workspace_id=_pick_default_workspace(memberships),
        )


@openapi_ns.route("/account/sessions/self")
class AccountSessionsSelfApi(Resource):
    @endpoint(requirements=_ACCOUNT_REQUIREMENTS, returns=(200, RevokeResponse, "Session revoked"))
    def delete(self, ctx: Context):
        revoke_oauth_token(redis_client, str(ctx.subject.token_id), session=ctx.session)
        return RevokeResponse(status="revoked")


@openapi_ns.route("/account/sessions")
class AccountSessionsApi(Resource):
    @endpoint(
        requirements=_ACCOUNT_REQUIREMENTS,
        query=SessionListQuery,
        returns=(200, SessionListResponse, "Session list"),
        write=False,
    )
    def get(self, ctx: Context, *, query: SessionListQuery):
        auth_ctx = get_auth_ctx()
        now = datetime.now(UTC)
        page = query.page
        limit = query.limit

        all_rows = list_active_sessions(auth_ctx, now, session=ctx.session)

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
    @endpoint(requirements=_ACCOUNT_REQUIREMENTS, returns=(200, RevokeResponse, "Session revoked"))
    def delete(self, ctx: Context, session_id: str):
        auth_ctx = get_auth_ctx()
        if not token_belongs_to_subject(session_id, auth_ctx, session=ctx.session):
            raise NotFound("session not found")

        revoke_oauth_token(redis_client, session_id, session=ctx.session)
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
