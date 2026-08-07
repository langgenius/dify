"""Flask adapter for Console API admission."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask import Response, abort, request

from configs import dify_config
from controllers.console.wraps import account_initialization_required, enterprise_license_required, setup_required
from core.logging.context import get_request_id, get_trace_id
from enums.deployment_edition import DeploymentEdition
from libs.login import current_account_with_tenant, login_required
from machinery.context import RequestContext


def console_account_admission[T, **P, R](
    *,
    editions: frozenset[DeploymentEdition] | None = None,
    require_valid_enterprise_license: bool = False,
) -> Callable[
    [Callable[Concatenate[T, RequestContext, P], R]],
    Callable[Concatenate[T, P], R | Response],
]:
    """Declare Console account admission and inject a stable RequestContext.

    All combinations use this decorator factory. Requirements are data, while
    the execution order stays fixed: edition, setup, login/CSRF, account
    initialization, optional enterprise license, then context construction.
    """

    def decorator(
        view: Callable[Concatenate[T, RequestContext, P], R],
    ) -> Callable[Concatenate[T, P], R | Response]:
        @wraps(view)
        def inject_request_context(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
            account_with_tenant = current_account_with_tenant()
            request_context = RequestContext(
                account_id=account_with_tenant.account.id,
                active_workspace_id=account_with_tenant.tenant_id,
                request_id=get_request_id(),
                trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
            )
            return view(self, request_context, *args, **kwargs)

        admitted: Callable[Concatenate[T, P], R | Response] = inject_request_context
        if require_valid_enterprise_license:
            admitted = enterprise_license_required(admitted)
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
