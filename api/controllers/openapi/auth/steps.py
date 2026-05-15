"""Pipeline steps. Each is one responsibility.

`BearerCheck` is the only step that touches the token registry; downstream
steps see only the populated `Context`. `BearerCheck` also assigns
``g.auth_ctx`` (the same way ``validate_bearer`` does) so the surface gate
+ any handler reading the request-scoped context has a single source of
truth across both auth-attach paths.
"""

from __future__ import annotations

from collections.abc import Callable

from flask import g
from werkzeug.exceptions import BadRequest, Forbidden, NotFound, Unauthorized

from configs import dify_config
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.strategies import AppAuthzStrategy, CallerMounter
from controllers.openapi.auth.surface_gate import check_surface
from extensions.ext_database import db
from libs.oauth_bearer import (
    AuthContext,
    InvalidBearerError,
    Scope,
    SubjectType,
    _extract_bearer,  # type: ignore[attr-defined]
    check_workspace_membership,
    get_authenticator,
)
from models import App, Tenant, TenantStatus


class BearerCheck:
    """Resolve bearer → populate identity fields. Rate-limit is enforced
    inside `BearerAuthenticator.authenticate`, so no separate step here.
    Also attaches the resolved `AuthContext` to ``g.auth_ctx`` — same shape
    the decorator-level ``validate_bearer`` writes — so the surface gate
    + downstream readers don't see two different identity sources."""

    def __call__(self, ctx: Context) -> None:
        token = _extract_bearer(ctx.request)
        if not token:
            raise Unauthorized("bearer required")

        try:
            authn = get_authenticator().authenticate(token)
        except InvalidBearerError as e:
            raise Unauthorized(str(e))

        ctx.subject_type = authn.subject_type
        ctx.subject_email = authn.subject_email
        ctx.subject_issuer = authn.subject_issuer
        ctx.account_id = authn.account_id
        ctx.scopes = frozenset(authn.scopes)
        ctx.source = authn.source
        ctx.token_id = authn.token_id
        ctx.expires_at = authn.expires_at
        ctx.token_hash = authn.token_hash
        ctx.cached_verified_tenants = dict(authn.verified_tenants)

        # Single source of truth for the request-scoped identity. Surface
        # gate + handlers read `g.auth_ctx` regardless of whether the route
        # ran the decorator path (`validate_bearer`) or the pipeline path.
        g.auth_ctx = authn


class ScopeCheck:
    """Verify ctx.scopes (already populated by BearerCheck) covers required."""

    def __call__(self, ctx: Context) -> None:
        if Scope.FULL in ctx.scopes or ctx.required_scope in ctx.scopes:
            return
        raise Forbidden("insufficient_scope")


class SurfaceCheck:
    """Reject the request if `g.auth_ctx.subject_type` is not in `accepted`.

    Delegates to `surface_gate.check_surface` so the inline decorator and
    the pipeline step emit identical audit events. Relies on `BearerCheck`
    (above) having set `g.auth_ctx`.
    """

    def __init__(self, *, accepted: frozenset[SubjectType]) -> None:
        self._accepted = accepted

    def __call__(self, ctx: Context) -> None:
        check_surface(self._accepted)


class AppResolver:
    """Read app_id from request.view_args, populate ctx.app + ctx.tenant.

    Every endpoint using the OAuth bearer pipeline must declare
    ``<string:app_id>`` in its route — that is the design lock-in (no body /
    header coupling).
    """

    def __call__(self, ctx: Context) -> None:
        app_id = (ctx.request.view_args or {}).get("app_id")
        if not app_id:
            raise BadRequest("app_id is required in path")
        app = db.session.get(App, app_id)
        if not app or app.status != "normal":
            raise NotFound("app not found")
        if not app.enable_api:
            raise Forbidden("service_api_disabled")
        tenant = db.session.get(Tenant, app.tenant_id)
        if tenant is None or tenant.status == TenantStatus.ARCHIVE:
            raise Forbidden("workspace unavailable")
        ctx.app, ctx.tenant = app, tenant


class WorkspaceMembershipCheck:
    """Layer 0 — workspace membership gate.

    CE-only (skipped when ENTERPRISE_ENABLED). Account-subject bearers
    (dfoa_) only — SSO subjects skip.
    """

    def __call__(self, ctx: Context) -> None:
        if dify_config.ENTERPRISE_ENABLED:
            return
        if ctx.subject_type != SubjectType.ACCOUNT:
            return
        if ctx.account_id is None or ctx.tenant is None:
            raise Unauthorized("account_id or tenant unset — BearerCheck or AppResolver did not run")
        if ctx.token_hash is None:
            raise Unauthorized("token_hash unset — BearerCheck did not run")

        check_workspace_membership(
            account_id=ctx.account_id,
            tenant_id=ctx.tenant.id,
            token_hash=ctx.token_hash,
            cached_verdicts=ctx.cached_verified_tenants or {},
        )


class AppAuthzCheck:
    def __init__(self, resolve_strategy: Callable[[], AppAuthzStrategy]) -> None:
        self._resolve = resolve_strategy

    def __call__(self, ctx: Context) -> None:
        if not self._resolve().authorize(ctx):
            raise Forbidden("subject_no_app_access")


class CallerMount:
    def __init__(self, *mounters: CallerMounter) -> None:
        self._mounters = mounters

    def __call__(self, ctx: Context) -> None:
        if ctx.subject_type is None:
            raise Unauthorized("subject_type unset — BearerCheck did not run")
        for m in self._mounters:
            if m.applies_to(ctx.subject_type):
                m.mount(ctx)
                return
        raise Unauthorized("no caller mounter for subject type")


__all__ = [
    "AppAuthzCheck",
    "AppResolver",
    "AuthContext",
    "BearerCheck",
    "CallerMount",
    "ScopeCheck",
    "SurfaceCheck",
    "WorkspaceMembershipCheck",
]
