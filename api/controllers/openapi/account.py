from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import cast

from flask_restx import Resource
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.common.session import with_session
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
    WorkspaceRoleResponse,
)
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData
from extensions.ext_application_services import application_services
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
from models import Account
from services.oauth_device_flow import (
    list_active_sessions,
    revoke_oauth_token,
    token_belongs_to_subject,
)
from services.workspace_query_service import WorkspaceWithRoles


@openapi_ns.route("/account")
class AccountApi(Resource):
    @auth_router.guard(scope=Scope.FULL, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, AccountResponse, description="Account info")
    def get(self, *, auth_data: AuthData):
        enforce(LIMIT_ME_PER_ACCOUNT, key=f"account:{auth_data.account_id}")

        assert auth_data.account_id is not None
        account = cast(Account, auth_data.caller)
        workspaces = application_services().workspace_queries.list_for_account_with_roles(str(auth_data.account_id))
        default_ws_id = _pick_default_workspace(workspaces)

        return AccountResponse(
            subject_type="account",
            subject_email=account.email,
            account=_account_payload(account),
            workspaces=[_workspace_payload(workspace) for workspace in workspaces],
            default_workspace_id=default_ws_id,
        )


@openapi_ns.route("/account/sessions/self")
class AccountSessionsSelfApi(Resource):
    @auth_router.guard(scope=Scope.FULL, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, RevokeResponse, description="Session revoked")
    @with_session
    def delete(self, session: Session, *, auth_data: AuthData):
        revoke_oauth_token(redis_client, str(auth_data.token_id), session=session)
        return RevokeResponse(status="revoked")


@openapi_ns.route("/account/sessions")
class AccountSessionsApi(Resource):
    @auth_router.guard(scope=Scope.FULL, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, SessionListResponse, description="Session list")
    @accepts(query=SessionListQuery)
    @with_session(write=False)
    def get(self, session: Session, *, auth_data: AuthData, query: SessionListQuery):
        # SessionListQuery enforces the advertised bounds (extra='forbid', page>=1,
        # 1<=limit<=MAX_PAGE_LIMIT) so the server rejects out-of-range paging rather
        # than silently coercing (e.g. page=0 -> empty slice).
        ctx = get_auth_ctx()
        now = datetime.now(UTC)
        page = query.page
        limit = query.limit

        all_rows = list_active_sessions(ctx, now, session=session)

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
    @with_session
    def delete(self, session: Session, session_id: str, *, auth_data: AuthData):
        ctx = get_auth_ctx()

        # 404 (not 403) on cross-subject so the endpoint doesn't leak
        # token IDs that belong to other subjects.
        if not token_belongs_to_subject(session_id, ctx, session=session):
            raise NotFound("session not found")

        revoke_oauth_token(redis_client, session_id, session=session)
        return RevokeResponse(status="revoked")


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def _pick_default_workspace(workspaces: Sequence[WorkspaceWithRoles]) -> str | None:
    if not workspaces:
        return None
    return next((workspace.id for workspace in workspaces if workspace.current), workspaces[0].id)


def _workspace_payload(workspace: WorkspaceWithRoles) -> WorkspacePayload:
    return WorkspacePayload(
        id=workspace.id,
        name=workspace.name or "",
        roles=[WorkspaceRoleResponse(id=role.id, name=role.name) for role in workspace.roles],
    )


def _account_payload(account) -> AccountPayload:
    return AccountPayload(id=str(account.id), email=account.email, name=account.name)
