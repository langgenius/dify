from collections.abc import Callable
from functools import wraps
from typing import Any

from flask import current_app, g, has_request_context, request
from flask_login.config import EXEMPT_METHODS
from werkzeug.local import LocalProxy

from configs import dify_config
from libs.token import check_csrf_token
from models import Account
from models.model import EndUser


def current_account_with_tenant():
    """
    Resolve the underlying account for the current user proxy and ensure tenant context exists.
    Allows tests to supply plain Account mocks without the LocalProxy helper.
    """
    user_proxy = current_user

    get_current_object = getattr(user_proxy, "_get_current_object", None)
    user = get_current_object() if callable(get_current_object) else user_proxy  # type: ignore

    if not isinstance(user, Account):
        raise ValueError("current_user must be an Account instance")
    assert user.current_tenant_id is not None, "The tenant information should be loaded."
    return user, user.current_tenant_id


from typing import ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


def login_required(func: Callable[P, R]):
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
    def decorated_view(*args: P.args, **kwargs: P.kwargs):
        if request.method in EXEMPT_METHODS or dify_config.LOGIN_DISABLED:
            pass
        elif current_user is not None and not current_user.is_authenticated:
            return current_app.login_manager.unauthorized()  # type: ignore
        # we put csrf validation here for less conflicts
        # TODO: maybe find a better place for it.
        check_csrf_token(request, current_user.id)
        return current_app.ensure_sync(func)(*args, **kwargs)

    return decorated_view


def _get_user() -> EndUser | Account | None:
    if has_request_context():
        if "_login_user" not in g:
            current_app.login_manager._load_user()  # type: ignore

        return g._login_user

    return None


#: A proxy for the current user. If no user is logged in, this will be an
#: anonymous user
# NOTE: Any here, but use _get_current_object to check the fields
current_user: Any = LocalProxy(lambda: _get_user())
