"""Auth pipeline — entry point for all openapi auth.

`PipelineRouter.guard()` is the only attachment point for endpoints.
`AuthPipeline` is a pure step-runner with no routing concerns.
`PipelineRoute` binds a pipeline to optional edition requirements.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps
from typing import Any

from flask import current_app, request
from flask_login import user_logged_in
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.openapi._audit import emit_wrong_surface
from controllers.openapi.auth.data import (
    AuthData,
    Edition,
    ExternalIdentity,
    RBACRequirement,
    RequestContext,
    current_edition,
)
from controllers.openapi.auth.flow import When
from libs.oauth_bearer import (
    AuthContext,
    Scope,
    TokenType,
    extract_bearer,
    get_authenticator,
    reset_auth_ctx,
    set_auth_ctx,
)
from models.account import TenantAccountRole
from services.feature_service import FeatureService, LicenseStatus


class AuthPipeline:
    """Pure step-runner — no routing, no guard.

    Both `prepare` and `auth` steps receive the same `AuthData` instance.
    `prepare` steps populate it; `auth` steps validate it.
    """

    def __init__(self, prepare: list, auth: list) -> None:
        self._prepare = prepare
        self._auth = auth

    def _run(
        self,
        identity: AuthContext,
        args: tuple,
        kwargs: dict,
        view: Callable,
        *,
        scope: Scope | None,
        workspace_membership: bool = False,
        allowed_roles: frozenset[TenantAccountRole] | None = None,
        rbac: RBACRequirement | None = None,
    ) -> Any:
        req_ctx = RequestContext(
            token_type=identity.token_type,
            scope=scope,
            path_params=dict(request.view_args or {}),
            workspace_membership=workspace_membership,
            allowed_roles=allowed_roles,
            rbac=rbac,
        )

        data = AuthData(
            token_type=identity.token_type,
            account_id=identity.account_id,
            token_hash=identity.token_hash,
            token_id=identity.token_id,
            scopes=frozenset(identity.scopes),
            tenants=dict(identity.verified_tenants),
            required_scope=scope,
            allowed_roles=allowed_roles,
            rbac=rbac,
            path_params=dict(req_ctx.path_params),
            external_identity=(
                ExternalIdentity(email=identity.subject_email, issuer=identity.subject_issuer)
                if identity.subject_email
                else None
            ),
        )

        for step in self._prepare:
            if _should_run(step, req_ctx, data=None):
                step(data)

        for step in self._auth:
            if _should_run(step, req_ctx, data=data):
                step(data)

        reset_token = set_auth_ctx(identity)
        if data.caller:
            _mount_flask_login(data.caller)

        try:
            kwargs["auth_data"] = data
            return view(*args, **kwargs)
        finally:
            reset_auth_ctx(reset_token)


@dataclass(frozen=True)
class PipelineRoute:
    pipeline: AuthPipeline
    required_edition: frozenset[Edition] | None = None


class PipelineRouter:
    """Entry point for openapi auth.

    `guard()` is the decorator that endpoints attach to. It applies
    global gates (edition, token type) then dispatches to the matching
    `PipelineRoute` for the token type.
    """

    def __init__(self, routes: dict[TokenType, PipelineRoute]) -> None:
        self._routes = routes

    def guard(
        self,
        *,
        scope: Scope | None = None,
        allowed_token_types: frozenset[TokenType] | None = None,
        edition: frozenset[Edition] | None = None,
        workspace_membership: bool = False,
        allowed_roles: frozenset[TenantAccountRole] | None = None,
        rbac: RBACRequirement | None = None,
    ) -> Callable:
        return self._make_decorator(
            scope=scope,
            allowed_token_types=allowed_token_types,
            edition=edition,
            workspace_membership=workspace_membership,
            allowed_roles=allowed_roles,
            rbac=rbac,
        )

    def guard_workspace(
        self,
        *,
        scope: Scope | None = None,
        allowed_token_types: frozenset[TokenType] | None = None,
        edition: frozenset[Edition] | None = None,
        allowed_roles: frozenset[TenantAccountRole] | None = None,
        rbac: RBACRequirement | None = None,
    ) -> Callable:
        return self._make_decorator(
            scope=scope,
            allowed_token_types=allowed_token_types,
            edition=edition,
            workspace_membership=True,
            allowed_roles=allowed_roles,
            rbac=rbac,
        )

    def _make_decorator(
        self,
        *,
        scope: Scope | None,
        allowed_token_types: frozenset[TokenType] | None,
        edition: frozenset[Edition] | None,
        workspace_membership: bool,
        allowed_roles: frozenset[TenantAccountRole] | None,
        rbac: RBACRequirement | None,
    ) -> Callable:
        def decorator(view: Callable) -> Callable:
            @wraps(view)
            def decorated(*args: Any, **kwargs: Any) -> Any:
                return self._execute(
                    args,
                    kwargs,
                    view,
                    scope=scope,
                    allowed_token_types=allowed_token_types,
                    edition=edition,
                    workspace_membership=workspace_membership,
                    allowed_roles=allowed_roles,
                    rbac=rbac,
                )

            return decorated

        return decorator

    def _execute(
        self,
        args: tuple,
        kwargs: dict,
        view: Callable,
        *,
        scope: Scope | None,
        allowed_token_types: frozenset[TokenType] | None,
        edition: frozenset[Edition] | None,
        workspace_membership: bool = False,
        allowed_roles: frozenset[TenantAccountRole] | None = None,
        rbac: RBACRequirement | None = None,
    ) -> Any:
        # 404 not 403 — this edition doesn't expose the feature at all
        if edition is not None and current_edition() not in edition:
            raise NotFound()

        license_checked = False
        if edition is not None and Edition.EE in edition:
            _check_license()
            license_checked = True

        token = extract_bearer(request)
        if not token:
            raise Unauthorized("bearer required")

        identity = get_authenticator().authenticate(token)

        if allowed_token_types is not None and identity.token_type not in allowed_token_types:
            emit_wrong_surface(
                subject_type=_subject_type_str(identity),
                attempted_path=request.path,
                client_id=getattr(identity, "client_id", None),
                token_id=str(identity.token_id) if identity.token_id else None,
            )
            raise Forbidden("unsupported_token_type")

        route = self._routes.get(identity.token_type)
        if route is None:
            raise Forbidden("unsupported_token_type")

        if route.required_edition is not None:
            if current_edition() not in route.required_edition:
                raise Forbidden("external_sso_requires_ee")
            if not license_checked and Edition.EE in route.required_edition:
                _check_license()

        return route.pipeline._run(
            identity,
            args,
            kwargs,
            view,
            scope=scope,
            workspace_membership=workspace_membership,
            allowed_roles=allowed_roles,
            rbac=rbac,
        )


def _should_run(step: Any, req_ctx: RequestContext, data: AuthData | None) -> bool:
    if isinstance(step, When):
        return step.applies(req_ctx, data)
    return True


def _subject_type_str(identity: Any) -> str | None:
    subject = getattr(identity, "subject_type", None)
    if subject is None:
        return None
    return subject.value if hasattr(subject, "value") else str(subject)


def _check_license() -> None:
    settings = FeatureService.get_system_features()
    if settings.license.status in {LicenseStatus.INACTIVE, LicenseStatus.EXPIRED, LicenseStatus.LOST}:
        raise Forbidden("license_invalid")


def _mount_flask_login(user: Any) -> None:
    current_app.login_manager._update_request_context_with_user(user)  # type: ignore[attr-defined]
    user_logged_in.send(current_app._get_current_object(), user=user)  # type: ignore[attr-defined]
