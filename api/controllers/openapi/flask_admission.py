"""Flask adapter for account-authenticated OpenAPI admission."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask import Response, request
from werkzeug.exceptions import Unauthorized

from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData
from core.logging.context import get_request_id, get_trace_id
from enums import DeploymentEdition
from libs.oauth_bearer import Scope, TokenType
from libs.rate_limit import RateLimit, enforce
from machinery.context import RequestContext
from models.account import Account, AccountStatus


def openapi_account_admission[T, **P, R](
    *,
    scope: Scope,
    editions: frozenset[DeploymentEdition] | None = None,
    require_initialized: bool = True,
    require_valid_enterprise_license: bool = True,
    rate_limit: RateLimit | None = None,
) -> Callable[
    [Callable[Concatenate[T, RequestContext, P], R]],
    Callable[Concatenate[T, P], R | Response],
]:
    """Authenticate an account bearer and inject framework-neutral identity.

    Client-version admission remains attached to the OpenAPI blueprint so it
    can also reject requests for removed routes. Edition and Enterprise
    license checks are delegated to the shared auth router before the stable
    context is constructed.
    """

    def decorator(
        view: Callable[Concatenate[T, RequestContext, P], R],
    ) -> Callable[Concatenate[T, P], R | Response]:
        @wraps(view)
        def inject_request_context(
            self: T,
            /,
            *args: P.args,
            auth_data: AuthData,
            **kwargs: P.kwargs,
        ) -> R:
            account = auth_data.caller
            if not isinstance(account, Account) or auth_data.account_id is None:
                raise Unauthorized("account not found")
            if require_initialized and account.status == AccountStatus.UNINITIALIZED:
                raise Unauthorized("account not initialized")

            account_id = str(auth_data.account_id)
            if rate_limit is not None:
                enforce(rate_limit, key=f"account:{account_id}")

            context = RequestContext(
                request_id=get_request_id(),
                trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
                account_id=account_id,
                active_workspace_id=account.current_tenant_id,
                access_token_id=str(auth_data.token_id) if auth_data.token_id is not None else None,
            )
            return view(self, context, *args, **kwargs)

        authenticated = auth_router.guard(
            scope=scope,
            allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
            edition=editions,
            require_valid_enterprise_license=require_valid_enterprise_license,
        )(inject_request_context)

        # Keep one stable test seam: one ``__wrapped__`` skips route admission
        # and reaches input parsing/response handling. Client-version admission
        # stays blueprint-wide by design.
        @wraps(view)
        def admitted(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R | Response:
            return authenticated(self, *args, **kwargs)

        return admitted

    return decorator
