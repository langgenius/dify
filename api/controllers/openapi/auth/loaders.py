"""One loader per datum, owning both the fetch and the "already there?" test, so
no requirement carries its own copy. Several requirements on one route call
the same loader; only the first pays for the query.

Imports `context` and the services; `requirements` imports this. `subjects`
must not — `context` imports `subjects`, so that edge would close a cycle.
"""

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


def load_app(ctx: Context) -> App:
    if not ctx.app_loaded:
        ctx.set_app(_fetch_app(ctx))
    return ctx.app


def load_workspace(ctx: Context) -> Tenant:
    if not ctx.workspace_loaded:
        ctx.set_workspace(_fetch_workspace(ctx))
    return ctx.workspace


def load_caller(ctx: Context) -> Account | EndUser:
    if not ctx.caller_loaded:
        ctx.set_caller(ctx.subject.resolve_caller(ctx, ctx.session))
    return ctx.caller


def load_workspace_role(ctx: Context) -> TenantAccountRole:
    if not ctx.workspace_role_loaded:
        ctx.set_workspace_role(_fetch_workspace_role(ctx))
    return ctx.workspace_role


def _fetch_app(ctx: Context) -> App:
    app_id = ctx.view_args["app_id"]
    try:
        uuid.UUID(app_id)
    except ValueError:
        raise NotFound("app not found")
    app = AppService.get_app_by_id(app_id, ctx.session)
    if not app or app.status != AppStatus.NORMAL:
        raise NotFound("app not found")
    return app


def _fetch_workspace(ctx: Context) -> Tenant:
    if ctx.has_app:
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
    """The caller's role in the loaded workspace.

    Non-membership answers 404, never 403, so workspace ids cannot be probed
    across tenants, and an account that is not `ACTIVE` is a non-member even
    when it still holds a role.

    The workspace is loaded before the caller: an account binds its current
    tenant only once the workspace is there.
    """
    workspace = load_workspace(ctx)
    caller = load_caller(ctx)
    if not isinstance(caller, Account) or caller.status != AccountStatus.ACTIVE:
        raise NotFound("workspace not found")
    role = TenantService.get_account_role_in_tenant(str(ctx.subject.account_id), str(workspace.id), session=ctx.session)
    if role is None:
        raise NotFound("workspace not found")
    return role
