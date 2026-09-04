"""Flask adapter for Console API admission."""

from collections.abc import Callable, Sequence
from functools import wraps
from typing import Concatenate

from flask import Response, abort, request
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.rbac import RBACCheck, enforce_rbac_checks
from controllers.console.wraps import (
    account_initialization_required,
    enable_change_email,
    enterprise_license_required,
    setup_required,
)
from core.logging.context import get_request_id, get_trace_id
from enums import DeploymentEdition
from libs.login import current_account_with_tenant, login_required
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.system_feature_service import SystemFeatureService


def console_email_registration_admission[T, **P, R](
    view: Callable[Concatenate[T, P], R],
) -> Callable[Concatenate[T, P], R | Response]:
    """Apply the complete admission policy for anonymous email registration."""

    @wraps(view)
    def check_registration_features(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        if (
            not SystemFeatureService.is_email_password_login_enabled()
            or not SystemFeatureService.is_registration_allowed()
        ):
            abort(403)
        return view(self, *args, **kwargs)

    return setup_required(check_registration_features)


def console_account_admission[T, **P, R](
    *,
    editions: frozenset[DeploymentEdition] | None = None,
    require_change_email_enabled: bool = False,
    require_initialized: bool = True,
    require_valid_enterprise_license: bool = False,
    allowed_roles: frozenset[TenantAccountRole] | None = None,
    rbac_checks: Sequence[RBACCheck] | None = None,
) -> Callable[
    [Callable[Concatenate[T, RequestContext, P], R]],
    Callable[Concatenate[T, P], R | Response],
]:
    """Declare Console account admission and inject a stable RequestContext.

    All combinations use this decorator factory. Requirements are data, while
    the execution order stays fixed: edition, setup, login/CSRF, optional
    account initialization, optional enterprise license, role/RBAC checks, then
    context construction.
    """

    def decorator(
        view: Callable[Concatenate[T, RequestContext, P], R],
    ) -> Callable[Concatenate[T, P], R | Response]:
        @wraps(view, updated=())
        def inject_request_context(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
            account_with_tenant = current_account_with_tenant()
            account = account_with_tenant.account
            tenant_id = account_with_tenant.tenant_id
            if allowed_roles is not None and not dify_config.RBAC_ENABLED and account.role not in allowed_roles:
                raise Forbidden()
            if rbac_checks is not None:
                enforce_rbac_checks(
                    tenant_id=tenant_id,
                    account_id=account.id,
                    checks=rbac_checks,
                    path_args=kwargs,
                )
            request_context = RequestContext(
                account_id=account.id,
                active_workspace_id=tenant_id,
                request_id=get_request_id(),
                trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
            )
            return view(self, request_context, *args, **kwargs)

        if rbac_checks is not None:
            inject_request_context.rbac_checks = rbac_checks  # pyrefly: ignore[missing-attribute]

        admitted: Callable[Concatenate[T, P], R | Response] = inject_request_context
        if require_change_email_enabled:
            admitted = enable_change_email(admitted)
        if require_valid_enterprise_license:
            admitted = enterprise_license_required(admitted)
        if require_initialized:
            admitted = account_initialization_required(admitted)
        admitted = login_required(admitted)
        admitted = setup_required(admitted)

        if editions is None:
            return admitted

        @wraps(view)
        def enforce_edition(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R | Response:
            if dify_config.DEPLOYMENT_EDITION not in editions:
                abort(404)
            return admitted(self, *args, **kwargs)

        return enforce_edition

    return decorator
