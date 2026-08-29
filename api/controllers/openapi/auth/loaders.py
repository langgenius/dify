from __future__ import annotations

import uuid

from flask import request
from werkzeug.exceptions import Forbidden, NotFound

from controllers.openapi.auth.context import Context
from models.account import Account, AccountStatus, Tenant, TenantAccountRole, TenantStatus
from models.enums import AppStatus
from models.model import App, EndUser
from services.account_service import TenantService
from services.app_service import AppService

_APP_ID = "app_id"


def route_has_app(ctx: Context) -> bool:
    """Whether the route carries an app at all, read off the path params the
    router stored. The store holds what the request resolved; the shape of the
    request is a question its readers answer for themselves.
    """
    return _APP_ID in ctx.view_args


def load_app(ctx: Context) -> App:
    """The boundary where an unset field becomes a value: fetched once per
    request, and non-optional from here on, so nothing downstream re-checks.
    """
    if ctx.app is None:
        ctx.app = _fetch_app(ctx)
    return ctx.app


def load_workspace(ctx: Context) -> Tenant:
    if ctx.workspace is None:
        ctx.workspace = _fetch_workspace(ctx)
    return ctx.workspace


def load_caller(ctx: Context) -> Account | EndUser:
    if ctx.caller is None:
        ctx.caller = ctx.subject.resolve_caller(ctx, ctx.session)
    return ctx.caller


def load_workspace_role(ctx: Context) -> TenantAccountRole:
    if ctx.workspace_role is None:
        ctx.workspace_role = _fetch_workspace_role(ctx)
    return ctx.workspace_role


def _path_param(ctx: Context, name: str) -> str:
    try:
        return ctx.view_args[name]
    except KeyError:
        raise LookupError(
            f"{name} is not a path parameter of this route: the requirement asking for it does not belong here"
        )


def _fetch_app(ctx: Context) -> App:
    raw = _path_param(ctx, _APP_ID)
    try:
        # Canonical dashed form, so a bare-hex path parameter names the same app.
        app_id = str(uuid.UUID(raw))
    except ValueError:
        raise NotFound("app not found")
    app = AppService.get_app_by_id(app_id, ctx.session)
    if not app or app.status != AppStatus.NORMAL:
        raise NotFound("app not found")
    return app


def _fetch_workspace(ctx: Context) -> Tenant:
    """Not a check that stands down, a source that follows the route: an
    app-scoped route takes its workspace from the app, every other one from the
    request. Both raise when their own source is absent.
    """
    if route_has_app(ctx):
        return _workspace_from_app(ctx)
    return _workspace_from_request(ctx)


def _workspace_from_app(ctx: Context) -> Tenant:
    app = load_app(ctx)
    tenant = TenantService.get_tenant_by_id(str(app.tenant_id), session=ctx.session)
    if tenant is None or tenant.status == TenantStatus.ARCHIVE:
        raise Forbidden("workspace unavailable")
    return tenant


def _workspace_from_request(ctx: Context) -> Tenant:
    workspace_id = ctx.view_args.get("workspace_id") or request.args.get("workspace_id")
    if not workspace_id:
        raise NotFound("workspace not found")
    try:
        uuid.UUID(workspace_id)
    except ValueError:
        raise NotFound("workspace not found")
    tenant = TenantService.get_tenant_by_id(workspace_id, session=ctx.session)
    if tenant is None or tenant.status == TenantStatus.ARCHIVE:
        raise NotFound("workspace not found")
    return tenant


def _fetch_workspace_role(ctx: Context) -> TenantAccountRole:
    workspace = load_workspace(ctx)
    caller = load_caller(ctx)
    if not isinstance(caller, Account) or caller.status != AccountStatus.ACTIVE:
        raise NotFound("workspace not found")
    role = TenantService.get_account_role_in_tenant(str(ctx.subject.account_id), str(workspace.id), session=ctx.session)
    if role is None:
        raise NotFound("workspace not found")
    return role
