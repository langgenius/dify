from functools import wraps
from typing import Any

from flask import current_app, g, has_request_context, request
from flask_login.config import EXEMPT_METHODS  # type: ignore
from werkzeug.exceptions import Unauthorized
from werkzeug.local import LocalProxy

from configs import dify_config
from extensions.ext_database import db
from models.account import Account, TenantAccountJoin
from models.model import EndUser

# Import workspace authentication service
from services.workspace_api_key_service import WorkspaceApiKeyService

#: A proxy for the current user. If no user is logged in, this will be an
#: anonymous user
current_user: Any = LocalProxy(lambda: _get_user())


def login_required(func):
    """
    If you decorate a view with this, it will ensure that the current user is
    logged in and authenticated before calling the actual view. (If they are
    not, it calls the :attr:`LoginManager.unauthorized` callback.) For
    example::

        @app.route('/post')
        @login_required
        def post():
            pass

    If there are only certain times you need to require that your user is
    logged in, you can do so with::

        if not current_user.is_authenticated:
            return current_app.login_manager.unauthorized()

    ...which is essentially the code that this function adds to your views.

    It can be convenient to globally turn off authentication when unit testing.
    To enable this, if the application configuration variable `LOGIN_DISABLED`
    is set to `True`, this decorator will be ignored.

    .. Note ::

       Per `W3 guidelines for CORS preflight requests
       <http://www.w3.org/TR/cors/#cross-origin-request-with-preflight-0>`_,
       HTTP ``OPTIONS`` requests are exempt from login checks.

    Enhanced to support workspace API key authentication:
    - Accepts both traditional web UI authentication and workspace API keys
    - Workspace API keys should be provided as "Bearer wsk-..." in Authorization header
    - Supports scope-based authorization for workspace API keys

    Usage with scopes:
        @login_required(['workspace:read', 'members:read'])
        def my_view():
            pass

    :param func: The view function to decorate.
    :type func: function
    """

    # Check if scopes are specified
    if callable(func):
        # Decorator applied directly to function (no scopes)
        return _create_login_decorator()(func)
    else:
        # Decorator called with parameters
        scopes = func  # In this case func is actually the scopes list
        return _create_login_decorator(scopes)


def _create_login_decorator(required_scopes=None):
    """Internal function to create login_required decorator"""

    def decorator(func):
        @wraps(func)
        def decorated_view(*args, **kwargs):
            if request.method in EXEMPT_METHODS or dify_config.LOGIN_DISABLED:
                pass
            else:
                # First try workspace API key authentication
                auth_header = request.headers.get("Authorization", "")
                if auth_header and auth_header.startswith("Bearer wsk-"):
                    # Workspace API key authentication
                    if not _authenticate_workspace_api_key(auth_header, required_scopes):
                        raise Unauthorized("Invalid or expired workspace API key")
                elif not current_user.is_authenticated:
                    return current_app.login_manager.unauthorized()  # type: ignore

            # flask 1.x compatibility
            # current_app.ensure_sync is only available in Flask >= 2.0
            if callable(getattr(current_app, "ensure_sync", None)):
                return current_app.ensure_sync(func)(*args, **kwargs)
            return func(*args, **kwargs)

        return decorated_view

    return decorator


def _authenticate_workspace_api_key(auth_header: str, required_scopes=None) -> bool:
    """Handle workspace API key authentication"""
    try:
        token = auth_header[7:]  # Remove "Bearer " prefix

        # Validate API key
        auth_data = WorkspaceApiKeyService.validate_workspace_api_key(token)
        if not auth_data:
            return False

        # Scope check
        if required_scopes:
            has_required_scope = WorkspaceApiKeyService.check_multiple_scopes(
                auth_data, required_scopes, require_all=False
            )
            if not has_required_scope:
                raise Unauthorized(f"Insufficient permissions. Required scopes: {required_scopes}")

        # Get account information
        account_id = auth_data.get("account_id")
        if account_id:
            account = db.session.query(Account).get(account_id)
            if not account or account.status != "active":
                return False
            g._login_user = account  # Set for current_user reference

        # Set request context
        g.current_tenant_id = auth_data["tenant_id"]
        # Enrich auth_data with role of the API key creator within tenant
        try:
            join = (
                db.session.query(TenantAccountJoin)
                .filter(
                    TenantAccountJoin.tenant_id == auth_data["tenant_id"],
                    TenantAccountJoin.account_id == auth_data.get("account_id"),
                )
                .first()
            )
            if join:
                auth_data["role"] = join.role
        except Exception:
            pass

        g.api_auth_data = auth_data
        g.is_workspace_api_auth = True  # Workspace authentication flag

        return True

    except Unauthorized:
        # Re-raise Unauthorized exceptions (don't convert to False)
        raise
    except Exception:
        return False


def login_required_for_workspace_api(required_scopes=None):
    """
    Workspace API specific authentication decorator.
    Only accepts workspace API key authentication.
    """

    def decorator(func):
        @wraps(func)
        def decorated_view(*args, **kwargs):
            # Only accept workspace API key authentication
            auth_header = request.headers.get("Authorization", "")
            if not auth_header or not auth_header.startswith("Bearer wsk-"):
                raise Unauthorized("Workspace API key required")

            # Validate workspace API key
            if not _authenticate_workspace_api_key(auth_header, required_scopes):
                raise Unauthorized("Invalid or expired workspace API key")

            # Set auth data in request context for easy access
            request.auth_data = g.api_auth_data

            # flask 1.x compatibility
            if callable(getattr(current_app, "ensure_sync", None)):
                return current_app.ensure_sync(func)(*args, **kwargs)
            return func(*args, **kwargs)

        return decorated_view

    return decorator


def _get_user() -> EndUser | Account | None:
    if has_request_context():
        if "_login_user" not in g:
            current_app.login_manager._load_user()  # type: ignore

        return g._login_user  # type: ignore

    return None
