"""Flask adapter for unauthenticated Web API admission."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask import Response, abort, request

from configs import dify_config
from controllers.console.wraps import (
    email_password_login_enabled,
    enterprise_license_required,
    setup_required,
)
from core.logging.context import get_request_id, get_trace_id
from enums import DeploymentEdition
from libs.helper import extract_remote_ip
from machinery.context import RequestContext


def web_anonymous_admission[T, **P, R](
    *,
    editions: frozenset[DeploymentEdition] | None = None,
    require_email_password_login: bool = False,
    require_valid_enterprise_license: bool = False,
) -> Callable[
    [Callable[Concatenate[T, RequestContext, P], R]],
    Callable[Concatenate[T, P], R | Response],
]:
    """Apply Web bootstrap policy and inject a stable anonymous request context."""

    def decorator(
        view: Callable[Concatenate[T, RequestContext, P], R],
    ) -> Callable[Concatenate[T, P], R | Response]:
        @wraps(view)
        def inject_request_context(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
            context = RequestContext(
                request_id=get_request_id(),
                trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
                account_id="",
                active_workspace_id="",
                remote_ip=extract_remote_ip(request),
            )
            return view(self, context, *args, **kwargs)

        admitted: Callable[Concatenate[T, P], R | Response] = inject_request_context
        if require_valid_enterprise_license:
            admitted = enterprise_license_required(admitted)
        if require_email_password_login:
            admitted = email_password_login_enabled(admitted)
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
