"""Flask adapter for Console API admission."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask import Response, abort, request
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.wraps import enforce_rbac_access
from controllers.console.wraps import (
    account_initialization_required,
    enable_change_email,
    enterprise_license_required,
    setup_required,
)
from core.logging.context import get_request_id, get_trace_id
from core.rbac import RBACPermission, RBACResourceScope
from enums import DeploymentEdition
from libs.login import current_account_with_tenant, login_required
from machinery.context import RequestContext
from machinery.errors import AdmissionConfigurationError
from models.account import TenantAccountRole


def console_account_admission[T, **P, R](
    *,
    editions: frozenset[DeploymentEdition] | None = None,
    require_change_email_enabled: bool = False,
    require_initialized: bool = True,
    require_valid_enterprise_license: bool = False,
    allowed_roles: frozenset[TenantAccountRole] | None = None,
    rbac_resource_scope: RBACResourceScope | None = None,
    rbac_permission: RBACPermission | None = None,
    rbac_resource_required: bool = True,
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

    if (rbac_resource_scope is None) != (rbac_permission is None):
        raise AdmissionConfigurationError("RBAC resource scope and permission must be configured together")

    def decorator(
        view: Callable[Concatenate[T, RequestContext, P], R],
    ) -> Callable[Concatenate[T, P], R | Response]:
        @wraps(view)
        def inject_request_context(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
            account_with_tenant = current_account_with_tenant()
            account = account_with_tenant.account
            tenant_id = account_with_tenant.tenant_id
            if allowed_roles is not None and not dify_config.RBAC_ENABLED and account.role not in allowed_roles:
                raise Forbidden()
            if rbac_resource_scope is not None and rbac_permission is not None:
                enforce_rbac_access(
                    tenant_id=tenant_id,
                    account_id=account.id,
                    resource_type=rbac_resource_scope,
                    scene=rbac_permission,
                    resource_required=rbac_resource_required,
                    path_args=kwargs,
                )
            request_context = RequestContext(
                account_id=account.id,
                active_workspace_id=tenant_id,
                request_id=get_request_id(),
                trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
            )
            return view(self, request_context, *args, **kwargs)

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
