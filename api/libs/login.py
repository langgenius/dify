from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import TYPE_CHECKING, Any, cast

from flask import Response, current_app, g, has_request_context, request
from flask_login.config import EXEMPT_METHODS
from werkzeug.local import LocalProxy

from configs import dify_config
from dify_app import DifyApp
from extensions.ext_login import DifyLoginManager
from libs.token import check_csrf_token
from models import Account

if TYPE_CHECKING:
    from models.model import EndUser


def _resolve_current_user() -> EndUser | Account | None:
    """
    Resolve the current user proxy to its underlying user object.
    This keeps unit tests working when they patch `current_user` directly
    instead of bootstrapping a full Flask-Login manager.
    """
    user_proxy = current_user
    get_current_object = getattr(user_proxy, "_get_current_object", None)
    return get_current_object() if callable(get_current_object) else user_proxy  # type: ignore


def _get_login_manager() -> DifyLoginManager:
    """Return the project login manager with Dify's narrowed unauthorized contract."""
    app = cast(DifyApp, current_app)
    return app.login_manager


def current_account_with_tenant() -> tuple[Account, str]:
    """
    Resolve the underlying account for the current user proxy and ensure tenant context exists.
    Allows tests to supply plain Account mocks without the LocalProxy helper.
    """
    user = _resolve_current_user()

    if not isinstance(user, Account):
        raise ValueError("current_user must be an Account instance")
    assert user.current_tenant_id is not None, "The tenant information should be loaded."
    return user, user.current_tenant_id


def login_required[**P, R](func: Callable[P, R]) -> Callable[P, R | Response]:
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

    :param func: The view function to decorate.
    :type func: function
    """

    @wraps(func)
    def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R | Response:
        if request.method in EXEMPT_METHODS or dify_config.LOGIN_DISABLED:
            return current_app.ensure_sync(func)(*args, **kwargs)

        user = _resolve_current_user()
        if user is None or not user.is_authenticated:
            # `DifyLoginManager` guarantees that the registered unauthorized handler
            # is surfaced here as a concrete Flask `Response`.
            unauthorized_response: Response = _get_login_manager().unauthorized()
            return unauthorized_response
        g._login_user = user
        # we put csrf validation here for less conflicts
        # TODO: maybe find a better place for it.
        check_csrf_token(request, user.id)
        return current_app.ensure_sync(func)(*args, **kwargs)

    return decorated_view


def _get_user() -> EndUser | Account | None:
    if has_request_context():
        if "_login_user" not in g:
            _get_login_manager().load_user_from_request_context()

        return g._login_user

    return None


#: A proxy for the current user. If no user is logged in, this will be an
#: anonymous user
# NOTE: Any here, but use _get_current_object to check the fields
current_user: Any = LocalProxy(lambda: _get_user())
