from __future__ import annotations

from datetime import UTC, datetime

from flask import request
from flask_restx import Resource
from werkzeug.exceptions import BadRequest, NotFound

from controllers.openapi import openapi_ns
from controllers.openapi._models import (
    MAX_PAGE_LIMIT,
    AccountPayload,
    AccountResponse,
    PaginationEnvelope,
    RevokeResponse,
    SessionListResponse,
    SessionRow,
    WorkspacePayload,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.oauth_bearer import (
    ACCEPT_USER_ANY,
    AuthContext,
    SubjectType,
    get_auth_ctx,
    validate_bearer,
)
from libs.rate_limit import (
    LIMIT_ME_PER_ACCOUNT,
    LIMIT_ME_PER_EMAIL,
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
    @openapi_ns.response(200, "Account info", openapi_ns.models[AccountResponse.__name__])
    @validate_bearer(accept=ACCEPT_USER_ANY)
    def get(self):
        ctx = get_auth_ctx()

        if ctx.subject_type == SubjectType.EXTERNAL_SSO:
            enforce(LIMIT_ME_PER_EMAIL, key=f"subject:{ctx.subject_email}")
        else:
            enforce(LIMIT_ME_PER_ACCOUNT, key=f"account:{ctx.account_id}")

        if ctx.subject_type == SubjectType.EXTERNAL_SSO:
            return AccountResponse(
                subject_type=ctx.subject_type,
                subject_email=ctx.subject_email,
                subject_issuer=ctx.subject_issuer,
                account=None,
                workspaces=[],
                default_workspace_id=None,
            ).model_dump(mode="json")

        account = AccountService.get_account_by_id(db.session, str(ctx.account_id)) if ctx.account_id else None
        memberships = (
            TenantService.get_account_memberships(db.session, str(ctx.account_id)) if ctx.account_id else []
        )
        default_ws_id = _pick_default_workspace(memberships)

        return AccountResponse(
            subject_type=ctx.subject_type,
            subject_email=ctx.subject_email or (account.email if account else None),
            account=_account_payload(account) if account else None,
            workspaces=[_workspace_payload(m) for m in memberships],
            default_workspace_id=default_ws_id,
        ).model_dump(mode="json")


@openapi_ns.route("/account/sessions/self")
class AccountSessionsSelfApi(Resource):
    @openapi_ns.response(200, "Session revoked", openapi_ns.models[RevokeResponse.__name__])
    @validate_bearer(accept=ACCEPT_USER_ANY)
    def delete(self):
        ctx = get_auth_ctx()
        _require_oauth_subject(ctx)
        revoke_oauth_token(db.session, redis_client, str(ctx.token_id))
        return RevokeResponse(status="revoked").model_dump(mode="json"), 200


@openapi_ns.route("/account/sessions")
class AccountSessionsApi(Resource):
    @openapi_ns.response(200, "Session list", openapi_ns.models[SessionListResponse.__name__])
    @validate_bearer(accept=ACCEPT_USER_ANY)
    def get(self):
        ctx = get_auth_ctx()
        now = datetime.now(UTC)
        page = int(request.args.get("page", "1"))
        limit = min(int(request.args.get("limit", "100")), MAX_PAGE_LIMIT)

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

        return (
            PaginationEnvelope.build(page=page, limit=limit, total=total, items=items).model_dump(mode="json"),
            200,
        )


@openapi_ns.route("/account/sessions/<string:session_id>")
class AccountSessionByIdApi(Resource):
    @openapi_ns.response(200, "Session revoked", openapi_ns.models[RevokeResponse.__name__])
    @validate_bearer(accept=ACCEPT_USER_ANY)
    def delete(self, session_id: str):
        ctx = get_auth_ctx()
        _require_oauth_subject(ctx)

        # 404 (not 403) on cross-subject so the endpoint doesn't leak
        # token IDs that belong to other subjects.
        if not token_belongs_to_subject(db.session, session_id, ctx):
            raise NotFound("session not found")

        revoke_oauth_token(db.session, redis_client, session_id)
        return RevokeResponse(status="revoked").model_dump(mode="json"), 200


def _require_oauth_subject(ctx: AuthContext) -> None:
    if not ctx.source.startswith("oauth"):
        raise BadRequest(
            "this endpoint revokes OAuth bearer tokens; use /openapi/v1/personal-access-tokens/self for PATs"
        )


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
