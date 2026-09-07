from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from flask import request
from flask_restx import Resource
from werkzeug.exceptions import NotFound, Unauthorized

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
from controllers.openapi.auth.requirements import (
    CheckEnterpriseLicense,
    CheckScope,
    CheckSessionOwnership,
    CheckSubject,
)
from controllers.openapi.auth.subjects import AccountSubject
from core.logging.context import get_request_id, get_trace_id
from extensions.ext_application_services import application_services
from libs.oauth_bearer import Scope
from libs.rate_limit import LIMIT_ME_PER_ACCOUNT, enforce
from machinery.context import AccountRequestContext
from services.account_errors import AccountNotFoundError, AccountSessionNotFoundError
from services.entities.account_access_entities import AccountSessionSnapshot, AccountWorkspaceSnapshot
from services.entities.account_entities import AccountSnapshot


@openapi_ns.route("/account")
class AccountApi(Resource):
    @endpoint(
        requirements=(CheckSubject(allowed=(AccountSubject,)), CheckEnterpriseLicense(), CheckScope(Scope.FULL)),
        returns=(200, AccountResponse, "Account info"),
        write=False,
    )
    def get(self, ctx: Context):
        request_context = _request_context(ctx)
        enforce(LIMIT_ME_PER_ACCOUNT, key=f"account:{request_context.account_id}")

        try:
            snapshot = application_services().accounts.access.get(request_context)
        except AccountNotFoundError:
            raise Unauthorized("account not found") from None
        return AccountResponse(
            subject_type=ctx.subject.subject_type,
            subject_email=snapshot.account.email,
            account=_account_payload(snapshot.account),
            workspaces=[_workspace_payload(workspace) for workspace in snapshot.workspaces],
            default_workspace_id=snapshot.default_workspace_id,
        )


@openapi_ns.route("/account/sessions/self")
class AccountSessionsSelfApi(Resource):
    @endpoint(
        requirements=(CheckSubject(allowed=(AccountSubject,)), CheckEnterpriseLicense(), CheckScope(Scope.FULL)),
        returns=(200, RevokeResponse, "Session revoked"),
    )
    def delete(self, ctx: Context):
        application_services().accounts.access.revoke_current_session(_request_context(ctx))
        return RevokeResponse(status="revoked")


@openapi_ns.route("/account/sessions")
class AccountSessionsApi(Resource):
    @endpoint(
        requirements=(CheckSubject(allowed=(AccountSubject,)), CheckEnterpriseLicense(), CheckScope(Scope.FULL)),
        query=SessionListQuery,
        returns=(200, SessionListResponse, "Session list"),
        write=False,
    )
    def get(self, ctx: Context, *, query: SessionListQuery):
        page = application_services().accounts.access.list_sessions(
            _request_context(ctx),
            page=query.page,
            limit=query.limit,
        )
        return SessionListResponse(
            page=page.page,
            limit=page.limit,
            total=page.total,
            has_more=page.has_more,
            data=[_session_row(session) for session in page.items],
        )


@openapi_ns.route("/account/sessions/<string:session_id>")
class AccountSessionByIdApi(Resource):
    @endpoint(
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckEnterpriseLicense(),
            CheckScope(Scope.FULL),
            CheckSessionOwnership(),
        ),
        returns=(200, RevokeResponse, "Session revoked"),
    )
    def delete(self, ctx: Context, session_id: str):
        try:
            token_id = str(UUID(session_id))
        except ValueError:
            raise NotFound("session not found") from None
        try:
            application_services().accounts.access.revoke_session(_request_context(ctx), token_id=token_id)
        except AccountSessionNotFoundError:
            # Do not reveal whether a token ID belongs to another account.
            raise NotFound("session not found") from None
        return RevokeResponse(status="revoked")


def _request_context(ctx: Context) -> AccountRequestContext:
    return AccountRequestContext(
        request_id=get_request_id(),
        trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
        account_id=str(ctx.subject.account_id),
        access_token_id=str(ctx.subject.token_id),
    )


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z")


def _session_row(session: AccountSessionSnapshot) -> SessionRow:
    return SessionRow(
        id=session.id,
        prefix=session.prefix,
        client_id=session.client_id,
        device_label=session.device_label,
        created_at=_iso(session.created_at),
        last_used_at=_iso(session.last_used_at),
        expires_at=_iso(session.expires_at),
    )


def _workspace_payload(workspace: AccountWorkspaceSnapshot) -> WorkspacePayload:
    return WorkspacePayload(id=workspace.id, name=workspace.name, role=workspace.role)


def _account_payload(account: AccountSnapshot) -> AccountPayload:
    return AccountPayload(id=account.id, email=account.email, name=account.name)
